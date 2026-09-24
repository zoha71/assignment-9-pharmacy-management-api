const express = require('express');
const {
  getExpiringMedicines,
  getLowStockMedicines
} = require('../controllers/medicineController');
const { protect } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/roleGuard');

const router = express.Router();

// Report aliases for expiring-soon and low-stock alerts
router.get('/expiring-soon', protect, authorizeRoles('pharmacist', 'admin'), getExpiringMedicines);
router.get('/low-stock', protect, authorizeRoles('pharmacist', 'admin'), getLowStockMedicines);

module.exports = router;
