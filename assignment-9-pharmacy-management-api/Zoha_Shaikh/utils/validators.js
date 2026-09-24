const mongoose = require('mongoose');

/**
 * Check if string is a valid MongoDB ObjectId
 */
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === id;
};

/**
 * Escapes regex special characters to prevent regex injection attacks in query searches
 */
const escapeRegex = (text) => {
  if (typeof text !== 'string') return '';
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
};

/**
 * Validates standard email address format
 */
const isValidEmail = (email) => {
  const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
  return typeof email === 'string' && emailRegex.test(email);
};

module.exports = {
  isValidObjectId,
  escapeRegex,
  isValidEmail
};
