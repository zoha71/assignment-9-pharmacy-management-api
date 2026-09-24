const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { isValidEmail } = require('../utils/validators');

/**
 * @desc    Register a new customer account
 * @route   POST /api/auth/register
 * @access  Public
 */
const register = async (req, res, next) => {
  try {
    const { name, email, password, phone, address } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'A valid email address is required' });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long' });
    }

    // Check duplicate email
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists' });
    }

    // Role is strictly forced to customer on the public register route
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: 'customer',
      phone: phone ? phone.trim() : undefined,
      address: address ? address.trim() : undefined
    });

    const token = generateToken(user);

    res.status(201).json({
      success: true,
      message: 'Customer registered successfully',
      token,
      user
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Register staff account (pharmacist or admin) using x-admin-key header
 * @route   POST /api/auth/register-staff
 * @access  Admin Key Protected (Header: x-admin-key)
 */
const registerStaff = async (req, res, next) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    const expectedKey = process.env.ADMIN_KEY;

    if (!adminKey || !expectedKey || adminKey !== expectedKey) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Invalid or missing admin key'
      });
    }

    const { name, email, password, role, phone, address } = req.body;

    // Validate role
    if (!role || !['pharmacist', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Role is required and must be either 'pharmacist' or 'admin'"
      });
    }

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'A valid email address is required' });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long' });
    }

    // Check duplicate email
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists' });
    }

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role,
      phone: phone ? phone.trim() : undefined,
      address: address ? address.trim() : undefined
    });

    const token = generateToken(user);

    res.status(201).json({
      success: true,
      message: `Staff member (${role}) registered successfully`,
      token,
      user
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Authenticate user & get token
 * @route   POST /api/auth/login
 * @access  Public
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    // Fetch user including password hash
    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');

    // Generic error message for security (never reveal if email vs password was wrong)
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const token = generateToken(user);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get current logged in user profile
 * @route   GET /api/auth/profile
 * @access  Private
 */
const getProfile = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      user: req.user
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  registerStaff,
  login,
  getProfile
};
