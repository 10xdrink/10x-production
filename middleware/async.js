/**
 * Async handler to wrap async functions and avoid try-catch blocks
 * @param {Function} fn - The async function to wrap
 * @returns {Function} - Express middleware function with error handling
 */
const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler; 