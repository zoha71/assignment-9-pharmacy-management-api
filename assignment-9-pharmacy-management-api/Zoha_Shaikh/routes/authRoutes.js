const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  register,
  registerStaff,
  login,
  getProfile
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Rate limiter for auth endpoints to protect against brute-force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // relaxed in test/dev, restricts brute force in production
  message: {
    success: false,
    message: 'Too many authentication attempts from this IP, please try again after 15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/register', authLimiter, register);
router.post('/register-staff', authLimiter, registerStaff);
router.post('/login', authLimiter, login);
router.get('/profile', protect, getProfile);

module.exports = router;
