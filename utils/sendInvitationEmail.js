// utils/sendInvitationEmail.js

const { sendEmail } = require('../services/emailService');
const logger = require('./logger');

/**
 * Send an invitation email to a new user
 * @param {string} email - Recipient email address
 * @param {string} token - Invitation token
 * @param {string} role - User role
 * @param {string} subject - Email subject
 * @param {string} message - Plain text message
 * @param {string} html - HTML message
 * @returns {Promise<void>}
 */
const sendInvitationEmail = async (email, token, role, subject, message, html) => {
  try {
    // Use the sendEmail service function
    await sendEmail({
      email,
      subject,
      message,
      html
    });
    logger.info(`Invitation email sent to ${email} for role ${role}`);
  } catch (error) {
    logger.error(`Failed to send invitation email to ${email}:`, error);
    throw new Error('Failed to send invitation email');
  }
};

module.exports = sendInvitationEmail; 