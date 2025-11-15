const jwt = require('jsonwebtoken');
const User = require('../models/User');
const mongoStore = require('../config/mongoSession');

// Define session expiration time in milliseconds
const SESSION_EXPIRATION_TIME = 30 * 60 * 1000; // 30 minutes
const TOKEN_REFRESH_THRESHOLD = 15 * 60 * 1000; // Refresh token if it's within 15 minutes of expiration

/**
 * Regenerate session token for long sessions
 * Note: Sessions are now managed by MongoDB via connect-mongodb-session
 * This method is kept for JWT token regeneration
 */
const regenerateSessionToken = (user) => {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
};

/**
 * Check if a session exists in MongoDB
 * @param {string} sessionId - The session ID to check
 * @param {function} callback - Callback function (err, exists)
 */
const checkActiveSession = async (sessionId, callback) => {
  try {
    if (!mongoStore) {
      return callback(new Error('MongoDB session store not initialized'), false);
    }
    
    // Get session from MongoDB store
    mongoStore.get(sessionId, (err, session) => {
      if (err) {
        console.error('Error checking active session:', err);
        callback(err, false);
      } else {
        callback(null, session !== null && session !== undefined);
      }
    });
  } catch (error) {
    console.error('Error checking active session:', error);
    callback(error, false);
  }
};

/**
 * Checks if a session is expired based on the last activity time.
 * @param {Date} lastActivity - The timestamp of the user's last activity.
 * @returns {boolean} - True if the session is expired, false otherwise.
 */
const isSessionExpired = (lastActivity) => {
  const now = Date.now();
  return now - new Date(lastActivity).getTime() > SESSION_EXPIRATION_TIME;
};

/**
 * Determines if a token should be refreshed based on the issued at (iat) time.
 * @param {number} iat - The issued at time of the token in seconds.
 * @returns {boolean} - True if the token should be refreshed, false otherwise.
 */
const shouldRefreshToken = (iat) => {
  const tokenAge = Date.now() - iat * 1000;
  return tokenAge >= SESSION_EXPIRATION_TIME - TOKEN_REFRESH_THRESHOLD;
};

/**
 * Updates the user's last activity timestamp in the database.
 * @param {string} userId - The ID of the user.
 */
const updateLastActivity = async (userId) => {
  await User.findByIdAndUpdate(
    userId, 
    { lastActivity: new Date() },
    { 
      runValidators: false, // Skip validation to prevent errors with other fields
      validateBeforeSave: false
    }
  );
};

/**
 * Generates a new access token for a user.
 * @param {Object} user - The user object containing user ID and role.
 * @returns {string} - The generated JWT token.
 */
const generateAccessToken = (user) => {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
};

module.exports = {
  regenerateSessionToken,
  checkActiveSession,
  isSessionExpired,
  shouldRefreshToken,
  updateLastActivity,
  generateAccessToken,
};
 