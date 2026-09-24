const Order = require('../models/Order');
const Medicine = require('../models/Medicine');
const { isValidObjectId } = require('../utils/validators');

/**
 * @desc    Place a new customer order
 * @route   POST /api/orders
 * @access  Private (Customer only)
 */
const createOrder = async (req, res, next) => {
  try {
    const { items, prescriptionNotes } = req.body;

    // Validate items array
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Order must contain a non-empty items array'
      });
    }

    // Merge duplicate medicine lines in cart
    const mergedMap = new Map();
    for (const item of items) {
      if (!item.medicineId || !isValidObjectId(item.medicineId)) {
        return res.status(400).json({
          success: false,
          message: `Invalid medicineId: ${item.medicineId || 'missing'}`
        });
      }

      const qty = parseInt(item.quantity, 10);
      if (isNaN(qty) || qty < 1) {
        return res.status(400).json({
          success: false,
          message: `Quantity for medicineId ${item.medicineId} must be a positive integer`
        });
      }

      const currentQty = mergedMap.get(item.medicineId) || 0;
      mergedMap.set(item.medicineId, currentQty + qty);
    }

    // Process each medicine item and compute server-side pricing
    const orderItems = [];
    let totalAmount = 0;
    let requiresPrescription = false;

    for (const [medicineId, quantity] of mergedMap.entries()) {
      const medicine = await Medicine.findById(medicineId);

      if (!medicine) {
        return res.status(404).json({
          success: false,
          message: `Medicine with ID ${medicineId} does not exist`
        });
      }

      // Check if medicine is expired
      if (new Date(medicine.expiryDate) <= new Date()) {
        return res.status(400).json({
          success: false,
          message: `Cannot order expired medicine '${medicine.name}'`
        });
      }

      // Check available stock
      if (medicine.stockQuantity < quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${medicine.name} (requested: ${quantity}, available: ${medicine.stockQuantity})`
        });
      }

      if (medicine.requiresPrescription) {
        requiresPrescription = true;
      }

      const unitPrice = medicine.price;
      const subtotal = unitPrice * quantity;
      totalAmount += subtotal;

      orderItems.push({
        medicine: medicine._id,
        name: medicine.name,
        quantity,
        unitPrice
      });
    }

    // Check prescription requirement
    if (requiresPrescription && (!prescriptionNotes || !prescriptionNotes.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Prescription notes are required when ordering prescription-restricted medicines'
      });
    }

    // Create the order with 'pending' status
    const order = await Order.create({
      customer: req.user._id,
      items: orderItems,
      totalAmount: Math.round(totalAmount * 100) / 100, // round to 2 decimal places
      prescriptionNotes: prescriptionNotes ? prescriptionNotes.trim() : undefined,
      requiresPrescription,
      prescriptionVerified: false,
      status: 'pending'
    });

    res.status(201).json({
      success: true,
      message: 'Order placed successfully and is pending approval',
      order
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get order history for logged-in customer
 * @route   GET /api/orders/my-orders
 * @access  Private (Customer only)
 */
const getMyOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ customer: req.user._id })
      .populate('items.medicine', 'name brand dosageForm price')
      .populate('reviewedBy', 'name role')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: orders.length,
      orders
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all orders with optional status filter
 * @route   GET /api/orders
 * @access  Private (Pharmacist / Admin)
 */
const getAllOrders = async (req, res, next) => {
  try {
    const { status } = req.query;
    const filter = {};

    if (status) {
      const allowedStatuses = ['pending', 'approved', 'dispensed', 'cancelled'];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status filter '${status}'. Allowed values: ${allowedStatuses.join(', ')}`
        });
      }
      filter.status = status;
    }

    const orders = await Order.find(filter)
      .populate('customer', 'name email phone')
      .populate('reviewedBy', 'name email role')
      .populate('items.medicine', 'name brand dosageForm')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: orders.length,
      orders
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update order status (Approve, Dispense, Reject/Cancel) with atomic stock deduction & rollback
 * @route   PATCH /api/orders/:id/status
 * @access  Private (Pharmacist / Admin)
 */
const updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, prescriptionVerified, rejectionReason } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: `Invalid order ID: ${id}`
      });
    }

    const allowedTargetStatuses = ['approved', 'dispensed', 'cancelled'];
    if (!status || !allowedTargetStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid target status. Must be one of: ${allowedTargetStatuses.join(', ')}`
      });
    }

    // Retrieve the current order
    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: `Order with ID ${id} not found`
      });
    }

    // Terminal states check
    if (['dispensed', 'cancelled'].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot change status of an order that is already ${order.status}`
      });
    }

    // =========================================================================
    // Transition 1: pending -> approved
    // =========================================================================
    if (order.status === 'pending' && status === 'approved') {
      // If order requires prescription, prescriptionVerified: true must be supplied
      if (order.requiresPrescription && prescriptionVerified !== true) {
        return res.status(400).json({
          success: false,
          message: 'Prescription must be verified before approval'
        });
      }

      /*
       * ATOMIC INVENTORY DEDUCTION ALGORITHM:
       * 1. Atomically claim the transition on the Order document (pending -> approved).
       *    If another staff member concurrently approved/cancelled it, findOneAndUpdate returns null.
       * 2. Decrement stock for each item using conditional updates:
       *    Medicine.updateOne({ _id: medicineId, stockQuantity: { $gte: qty } }, { $inc: { stockQuantity: -qty } })
       * 3. If any item fails (insufficient stock), rollback all previously decremented items via $inc: +qty
       *    and revert the order back to 'pending', then return 400 error.
       */
      const claimedOrder = await Order.findOneAndUpdate(
        { _id: order._id, status: 'pending' },
        {
          status: 'approved',
          prescriptionVerified: order.requiresPrescription ? true : (prescriptionVerified || false),
          reviewedBy: req.user._id
        },
        { new: true }
      );

      if (!claimedOrder) {
        return res.status(409).json({
          success: false,
          message: 'Conflict: Order was already processed or status was modified concurrently'
        });
      }

      const decrementedItems = [];
      let stockFailureMessage = null;

      for (const item of claimedOrder.items) {
        const updateResult = await Medicine.updateOne(
          {
            _id: item.medicine,
            stockQuantity: { $gte: item.quantity }
          },
          {
            $inc: { stockQuantity: -item.quantity }
          }
        );

        if (updateResult.modifiedCount !== 1) {
          // Stock deduction failed for this item
          stockFailureMessage = `Insufficient stock for ${item.name}`;
          break;
        }

        decrementedItems.push(item);
      }

      // If any item failed to decrement, roll back previously decremented items & revert order
      if (stockFailureMessage) {
        for (const rolledBackItem of decrementedItems) {
          await Medicine.updateOne(
            { _id: rolledBackItem.medicine },
            { $inc: { stockQuantity: rolledBackItem.quantity } }
          );
        }

        // Revert order back to pending
        await Order.findByIdAndUpdate(order._id, {
          status: 'pending',
          reviewedBy: null,
          prescriptionVerified: false
        });

        return res.status(400).json({
          success: false,
          message: stockFailureMessage
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Order approved and inventory stock decremented successfully',
        order: claimedOrder
      });
    }

    // =========================================================================
    // Transition 2: pending -> cancelled (Order Rejection)
    // =========================================================================
    if (order.status === 'pending' && status === 'cancelled') {
      const updatedOrder = await Order.findOneAndUpdate(
        { _id: order._id, status: 'pending' },
        {
          status: 'cancelled',
          rejectionReason: rejectionReason || 'Order rejected by pharmacy staff',
          reviewedBy: req.user._id
        },
        { new: true }
      );

      if (!updatedOrder) {
        return res.status(409).json({
          success: false,
          message: 'Conflict: Order was already processed concurrently'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Order cancelled/rejected successfully',
        order: updatedOrder
      });
    }

    // =========================================================================
    // Transition 3: approved -> dispensed (Medicine Handover)
    // =========================================================================
    if (order.status === 'approved' && status === 'dispensed') {
      const updatedOrder = await Order.findOneAndUpdate(
        { _id: order._id, status: 'approved' },
        {
          status: 'dispensed',
          reviewedBy: req.user._id
        },
        { new: true }
      );

      if (!updatedOrder) {
        return res.status(409).json({
          success: false,
          message: 'Conflict: Order is not in approved state'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Order dispensed successfully to customer',
        order: updatedOrder
      });
    }

    // =========================================================================
    // Transition 4: approved -> cancelled (Post-approval cancellation with inventory RESTOCK)
    // =========================================================================
    if (order.status === 'approved' && status === 'cancelled') {
      const updatedOrder = await Order.findOneAndUpdate(
        { _id: order._id, status: 'approved' },
        {
          status: 'cancelled',
          rejectionReason: rejectionReason || 'Order cancelled after approval - inventory restocked',
          reviewedBy: req.user._id
        },
        { new: true }
      );

      if (!updatedOrder) {
        return res.status(409).json({
          success: false,
          message: 'Conflict: Order is not in approved state'
        });
      }

      // Restore previously deducted stock
      for (const item of updatedOrder.items) {
        await Medicine.updateOne(
          { _id: item.medicine },
          { $inc: { stockQuantity: item.quantity } }
        );
      }

      return res.status(200).json({
        success: true,
        message: 'Order cancelled and medicine stock restored successfully to inventory',
        order: updatedOrder
      });
    }

    // Any disallowed transition
    return res.status(400).json({
      success: false,
      message: `Invalid status transition from '${order.status}' to '${status}'`
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createOrder,
  getMyOrders,
  getAllOrders,
  updateOrderStatus
};
