const jwt = require('jsonwebtoken');
const asyncHandler = require('./async');
const ErrorResponse = require('../utils/errorResponse');
const User = require('../models/User');
const InfluencerUser = require('../models/InfluencerUser');
const logger = require('../utils/logger');

// Protect routes
exports.protect = asyncHandler(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    // Set token from Bearer token in header
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies?.token) {
    // Set token from cookie
    token = req.cookies.token;
  }

  // Make sure token exists
  if (!token) {
    logger.warn('No auth token provided');
    return next(new ErrorResponse('Not authorized to access this route', 401));
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    logger.info(`Token decoded: ${JSON.stringify({ id: decoded.id, role: decoded.role })}`);

    // Check if user is an admin or influencer based on role in token
    if (decoded.role === 'admin') {
      req.user = await User.findById(decoded.id);
      if (!req.user) {
        logger.warn(`Admin user not found: ${decoded.id}`);
        return next(new ErrorResponse('User not found', 404));
      }
    } else if (decoded.role === 'influencer') {
      req.user = await InfluencerUser.findById(decoded.id);
      
      if (!req.user) {
        logger.warn(`Influencer user not found: ${decoded.id}`);
        return next(new ErrorResponse('User not found', 404));
      }
      
      // Ensure role is set
      req.user.role = 'influencer';
    } else {
      logger.warn(`Invalid role in token: ${decoded.role}`);
      return next(new ErrorResponse('User role not authorized', 401));
    }

    logger.info(`User authenticated: ${req.user.email} (${req.user.role})`);
    next();
  } catch (err) {
    logger.error(`Token verification error: ${err.message}`);
    return next(new ErrorResponse('Not authorized to access this route', 401));
  }
});

// Grant access to specific roles
exports.authorize = (...roles) => {
  return (req, res, next) => {
    logger.info(`Checking authorization for role: ${req.user.role}, allowed roles: ${roles.join(', ')}`);
    
    // For influencer routes, check if user is an influencer
    if (roles.includes('influencer') && req.user.role === 'influencer') {
      return next();
    }
    
    // For admin roles, check if user has appropriate role
    if (!roles.includes(req.user.role)) {
      logger.warn(`User ${req.user.email} with role ${req.user.role} attempted to access route restricted to ${roles.join(', ')}`);
      return next(
        new ErrorResponse(
          `User role ${req.user.role} is not authorized to access this route`,
          403
        )
      );
    }
    
    next();
  };
}; 