// services/emailService.js

const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const logger = require('../utils/logger');

// Set the AWS Region
const AWS_REGION = process.env.AWS_REGION || 'ap-south-1'; // Use region from env or default to ap-south-1

// Check for required environment variables
if (!process.env.AWS_ACCESS_KEY_ID && !process.env.SMTPusername) {
  logger.error('AWS_ACCESS_KEY_ID or SMTPusername is not defined in environment variables');
  throw new Error('AWS credentials are not defined in environment variables');
}

if (!process.env.AWS_SECRET_ACCESS_KEY && !process.env.SMTPpassword) {
  logger.error('AWS_SECRET_ACCESS_KEY or SMTPpassword is not defined in environment variables');
  throw new Error('AWS credentials are not defined in environment variables');
}

// Set SMTP variables if they're not already set
if (!process.env.SMTPusername && process.env.AWS_ACCESS_KEY_ID) {
  process.env.SMTPusername = process.env.AWS_ACCESS_KEY_ID;
}

if (!process.env.SMTPpassword && process.env.AWS_SECRET_ACCESS_KEY) {
  process.env.SMTPpassword = process.env.AWS_SECRET_ACCESS_KEY;
}

// Ensure FROM_EMAIL is set
const FROM_EMAIL = process.env.FROM_EMAIL || process.env.SUPPORT_EMAIL || 'tenexformula7@gmail.com';
logger.info(`Using FROM_EMAIL: ${FROM_EMAIL}`);

// Get credentials from environment variables - prefer standard AWS env vars if available
const accessKeyId = (process.env.AWS_ACCESS_KEY_ID || process.env.SMTPusername || '').trim();
const secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY || process.env.SMTPpassword || '').trim();

// Configure AWS SES Client with explicit configuration
const sesClient = new SESClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
  endpoint: `https://email.${AWS_REGION}.amazonaws.com`,
  forcePathStyle: false,
  maxAttempts: 3,
  // Add custom user agent to help with debugging
  customUserAgent: '10xDrink/1.0'
});

/**
 * Send an email using AWS SES
 * @param {Object} options - Email options
 * @param {string} options.email - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.message - Plain text message content
 * @param {string} options.html - HTML message content
 * @returns {Promise<void>}
 */
const sendEmail = async ({ email, subject, message, html }) => {
  if (!email) {
    logger.error('sendEmail: Recipient email is undefined');
    throw new Error('Recipient email is required');
  }

  try {
    // Create the email parameters
    const params = {
      Source: FROM_EMAIL,
      Destination: {
        ToAddresses: [email],
      },
      Message: {
        Subject: {
          Data: subject,
          Charset: 'UTF-8',
        },
        Body: {
          Text: {
            Data: message || '',
            Charset: 'UTF-8',
          },
          ...(html && {
            Html: {
              Data: html,
              Charset: 'UTF-8',
            },
          }),
        },
      },
    };

    // Send email using AWS SES
    const command = new SendEmailCommand(params);
    const response = await sesClient.send(command);
    logger.info(`Email sent to ${email} via AWS SES with message ID: ${response.MessageId}`);
  } catch (error) {
    logger.error(`Failed to send email to ${email} via AWS SES: ${error.message}`);
    if (error.Code) {
      logger.error(`AWS SES Error Code: ${error.Code}`);
    }
    throw new Error('Email could not be sent');
  }
};

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
    // Use the base sendEmail function
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

// Export both functions
module.exports = {
  sendEmail,
  sendInvitationEmail
};
