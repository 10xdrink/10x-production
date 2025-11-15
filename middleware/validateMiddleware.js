const { validationResult } = require('express-validator');
const ERROR_CODES = require('../constants/errorCodes');
const logger = require('../utils/logger');

/**
 * Middleware to validate request based on express-validator rules
 */
const validateMiddleware = (req, res, next) => {
  console.log('Running validation middleware on route:', req.originalUrl);
  console.log('Request body:', req.body);
  console.log('Request query params:', req.query);
  
  // Special case for products API to handle common issues
  if (req.originalUrl.includes('/products') && req.method === 'GET') {
    // Sanitize query parameters
    if (req.query.page) req.query.page = parseInt(req.query.page) || 1;
    if (req.query.limit) req.query.limit = parseInt(req.query.limit) || 10;
    
    // Handle sortBy and sortOrder
    if (req.query.sortBy && !['title', 'price', 'createdAt', 'totalSold', 'stock'].includes(req.query.sortBy)) {
      req.query.sortBy = 'createdAt'; // Default to a safe value
    }
    
    if (req.query.sortOrder && !['asc', 'desc'].includes(req.query.sortOrder)) {
      req.query.sortOrder = 'desc'; // Default to descending
    }
  }
  
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    console.log('Validation errors found:', errors.array());
    const extractedErrors = errors.array().map(err => ({
      field: err.path || err.param || 'unknown_field', // Use `err.path` if `param` is missing
      message: err.msg,
    }));

    logger.warn('Validation failed', {
      requestBody: req.body,
      requestQuery: req.query,
      validationErrors: extractedErrors,
    });

    return res.status(422).json({
      success: false,
      message: ERROR_CODES.INVALID_INPUT,
      errors: extractedErrors,
    });
  }
  
  console.log('Validation passed successfully');
  next();
};

module.exports = validateMiddleware;
