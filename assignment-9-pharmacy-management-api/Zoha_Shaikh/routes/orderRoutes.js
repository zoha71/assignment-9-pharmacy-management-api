const express = require('express');
const {
  createOrder,
  getMyOrders,
  getAllOrders,
  updateOrderStatus
} = require('../controllers/orderController');
const { protect } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/roleGuard');

const router = express.Router();

// Customer only order placement and history
router.post('/', protect, authorizeRoles('customer'), createOrder);
router.get('/my-orders', protect, authorizeRoles('customer'), getMyOrders);

// Staff order management and approvals
router.get('/', protect, authorizeRoles('pharmacist', 'admin'), getAllOrders);
router.patch('/:id/status', protect, authorizeRoles('pharmacist', 'admin'), updateOrderStatus);

module.exports = router;
