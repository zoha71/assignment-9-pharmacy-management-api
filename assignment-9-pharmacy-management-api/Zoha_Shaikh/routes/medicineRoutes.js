const express = require('express');
const {
  getMedicines,
  getExpiringMedicines,
  getLowStockMedicines,
  createMedicine,
  updateMedicine,
  deleteMedicine
} = require('../controllers/medicineController');
const { protect, optionalAuth } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/roleGuard');

const router = express.Router();

// Public medicine catalog browsing (with optional auth for staff includeExpired param)
router.get('/', optionalAuth, getMedicines);

// Staff aggregation reports (registered BEFORE /:id parameter)
router.get('/expiring', protect, authorizeRoles('pharmacist', 'admin'), getExpiringMedicines);
router.get('/low-stock', protect, authorizeRoles('pharmacist', 'admin'), getLowStockMedicines);

// Staff medicine management
router.post('/', protect, authorizeRoles('pharmacist', 'admin'), createMedicine);
router.put('/:id', protect, authorizeRoles('pharmacist', 'admin'), updateMedicine);

// Admin-only medicine deletion
router.delete('/:id', protect, authorizeRoles('admin'), deleteMedicine);

module.exports = router;
