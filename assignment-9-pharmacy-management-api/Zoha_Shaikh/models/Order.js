const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    medicine: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medicine',
      required: [true, 'Medicine ID is required']
    },
    name: {
      type: String,
      required: [true, 'Medicine name snapshot is required']
    },
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [1, 'Quantity must be at least 1'],
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not an integer value for quantity'
      }
    },
    unitPrice: {
      type: Number,
      required: [true, 'Unit price is required'],
      min: [0, 'Unit price cannot be negative']
    }
  },
  { _id: true }
);

const orderSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Customer ID is required']
    },
    items: {
      type: [orderItemSchema],
      required: [true, 'Order must contain at least one item'],
      validate: {
        validator: function (items) {
          return items && items.length > 0;
        },
        message: 'Order items array cannot be empty'
      }
    },
    totalAmount: {
      type: Number,
      required: [true, 'Total amount is required'],
      min: [0, 'Total amount cannot be negative']
    },
    prescriptionNotes: {
      type: String,
      trim: true
    },
    requiresPrescription: {
      type: Boolean,
      default: false
    },
    prescriptionVerified: {
      type: Boolean,
      default: false
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    rejectionReason: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      enum: {
        values: ['pending', 'approved', 'dispensed', 'cancelled'],
        message: 'Status must be pending, approved, dispensed, or cancelled'
      },
      default: 'pending'
    }
  },
  {
    timestamps: true
  }
);

// Compound and individual indexes for customer and status filtering
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
