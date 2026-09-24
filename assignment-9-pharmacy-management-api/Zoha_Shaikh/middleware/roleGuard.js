/**
 * Restrict access to specific roles
 * @param  {...string} roles - Allowed roles (e.g. 'admin', 'pharmacist', 'customer')
 */
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required before checking permissions.'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied: requires role ${roles.join(' or ')} (current role: ${req.user.role})`
      });
    }

    next();
  };
};

module.exports = { authorizeRoles };
