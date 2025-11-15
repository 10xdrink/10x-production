// services/redisService.js
// NOTE: Redis has been replaced with MongoDB for session management.
// This service is kept as a no-op to prevent breaking existing code.
// Consider implementing a MongoDB-based caching solution if caching is needed.

const logger = require('../utils/logger');

/**
 * No-op cache set function (Redis removed)
 * @param {string} key - The key under which the value is stored.
 * @param {any} value - The value to store (will be stringified).
 * @param {number} expirationInSeconds - Time to live in seconds.
 */
const setCache = async (key, value, expirationInSeconds) => {
  // No-op: Redis has been removed
  logger.debug(`Cache set called for key: ${key} (no-op - Redis removed)`);
};

/**
 * No-op cache get function (Redis removed)
 * @param {string} key - The key to retrieve.
 * @returns {any|null} - Always returns null.
 */
const getCache = async (key) => {
  // No-op: Redis has been removed, always return null (cache miss)
  logger.debug(`Cache get called for key: ${key} (no-op - Redis removed)`);
  return null;
};

/**
 * No-op cache delete function (Redis removed)
 * @param {string} key - The key to delete.
 */
const deleteCache = async (key) => {
  // No-op: Redis has been removed
  logger.debug(`Cache delete called for key: ${key} (no-op - Redis removed)`);
};

module.exports = {
  setCache,
  getCache,
  deleteCache,
};
