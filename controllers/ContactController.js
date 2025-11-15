// controllers/contactController.js

const path = require("path");
const handlebars = require("handlebars");
const fs = require("fs");
const sendEmail = require("../utils/sendEmail");
const logger = require("../utils/logger");
const ERROR_CODES = require("../constants/errorCodes");

/**
 * @desc    Handle contact form submission
 * @route   POST /api/contact
 * @access  Public
 */
exports.submitContactMessage = async (req, res, next) => {
  try {
    const { name, email, message, termsAgreed } = req.body;

    // Basic validation
    if (!name || !email || !message) {
      logger.warn("Contact Submission: Missing required fields", { name, email, message });
      return res.status(400).json({
        success: false,
        message: "Please provide name, email, and message",
      });
    }
    
    // Save to database
    const ContactMessage = require('../models/ContactMessage');
    const contactMessage = new ContactMessage({
      name,
      email,
      message,
      termsAgreed: termsAgreed || false,
      status: 'new'
    });
    
    await contactMessage.save();
    logger.info(`New contact message saved to database from ${email}`);
    

    // Check if SUPPORT_EMAIL is defined
    if (!process.env.SUPPORT_EMAIL) {
      logger.error("SUPPORT_EMAIL is not defined in environment variables");
      return res.status(500).json({
        success: false,
        message: "Server configuration error: Support email not set",
      });
    }

    // Load and compile the contact message HTML template
    const templatePath = path.join(__dirname, "../templates/contactMessage.html");
    if (!fs.existsSync(templatePath)) {
      logger.error(`Contact Message Template not found at path: ${templatePath}`);
      return res.status(500).json({
        success: false,
        message: "Server configuration error: Email template missing",
      });
    }

    const templateSource = fs.readFileSync(templatePath, "utf8");
    const template = handlebars.compile(templateSource);

    const htmlContent = template({
      name,
      email,
      message,
      supportUrl: process.env.SUPPORT_URL || "https://yourcompany.com/contact",
    });

    // Define plain text message as a fallback
    const plainTextMessage = `
You have received a new contact message from your website:

Name: ${name}
Email: ${email}
Message:
${message}

Please review and respond to this message at your earliest convenience.

Best regards,
Your Company Team
    `;

    // Send the contact message to support email
    await sendEmail({
      email: process.env.SUPPORT_EMAIL, // Support email from environment variables
      subject: `New Contact Message from ${name}`,
      message: plainTextMessage,
      html: htmlContent, // Send the HTML content
    });

    logger.info(`Contact message sent from ${email}`);

    // Optionally, send acknowledgment email to the user
    // Check if FROM_EMAIL is set for sending acknowledgment
    if (!process.env.FROM_EMAIL) {
      logger.error("FROM_EMAIL is not defined in environment variables");
      return res.status(500).json({
        success: false,
        message: "Server configuration error: From email not set",
      });
    }

    // Load and compile the acknowledgment email template
    const ackTemplatePath = path.join(__dirname, "../templates/contactAcknowledgment.html");
    if (!fs.existsSync(ackTemplatePath)) {
      logger.error(`Contact Acknowledgment Template not found at path: ${ackTemplatePath}`);
      return res.status(500).json({
        success: false,
        message: "Server configuration error: Email template missing",
      });
    }

    const ackTemplateSource = fs.readFileSync(ackTemplatePath, "utf8");
    const ackTemplate = handlebars.compile(ackTemplateSource);

    const ackHtmlContent = ackTemplate({
      name,
      supportUrl: process.env.SUPPORT_URL || "https://yourcompany.com/contact",
    });

    const ackPlainTextMessage = `
Hello ${name},

Thank you for reaching out to us. We have received your message and will get back to you shortly.

Best regards,
Your Company Team
    `;

    await sendEmail({
      email: email,
      subject: "Thank You for Contacting Us",
      message: ackPlainTextMessage,
      html: ackHtmlContent,
    });

    logger.info(`Acknowledgment email sent to ${email}`);

    res.status(200).json({
      success: true,
      message: "Your message has been sent successfully.",
    });
  } catch (error) {
    logger.error("Contact Submission Error:", error);
    res.status(500).json({ success: false, message: ERROR_CODES.SERVER_ERROR });
  }
};

/**
 * @desc    Get all contact messages
 * @route   GET /api/contact
 * @access  Private/Admin
 */
exports.getContactMessages = async (req, res, next) => {
  try {
    const ContactMessage = require('../models/ContactMessage');
    
    // Pagination parameters
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;
    
    // Search parameters
    const search = req.query.search || '';
    const searchQuery = search ? {
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { message: { $regex: search, $options: 'i' } }
      ]
    } : {};
    
    // Status filter
    if (req.query.status && ['new', 'in-progress', 'resolved'].includes(req.query.status)) {
      searchQuery.status = req.query.status;
    }
    
    // Get total count for pagination
    const total = await ContactMessage.countDocuments(searchQuery);
    
    // Get contact messages
    const messages = await ContactMessage.find(searchQuery)
      .sort({ createdAt: -1 })
      .skip(startIndex)
      .limit(limit);
    
    res.status(200).json({
      success: true,
      data: messages,
      pagination: {
        totalItems: total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        itemsPerPage: limit
      }
    });
  } catch (error) {
    logger.error(`Error fetching contact messages: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch contact messages',
      error: error.message
    });
  }
};

/**
 * @desc    Get a single contact message
 * @route   GET /api/contact/:id
 * @access  Private/Admin
 */
exports.getContactMessage = async (req, res, next) => {
  try {
    const ContactMessage = require('../models/ContactMessage');
    const message = await ContactMessage.findById(req.params.id);
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Contact message not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: message
    });
  } catch (error) {
    logger.error(`Error fetching contact message: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch contact message',
      error: error.message
    });
  }
};

/**
 * @desc    Update contact message status
 * @route   PUT /api/contact/:id
 * @access  Private/Admin
 */
exports.updateContactMessage = async (req, res, next) => {
  try {
    const ContactMessage = require('../models/ContactMessage');
    const { status } = req.body;
    
    if (!status || !['new', 'in-progress', 'resolved'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid status (new, in-progress, resolved)'
      });
    }
    
    const message = await ContactMessage.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Contact message not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: message,
      message: 'Contact message status updated successfully'
    });
  } catch (error) {
    logger.error(`Error updating contact message: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to update contact message',
      error: error.message
    });
  }
};

/**
 * @desc    Delete a contact message
 * @route   DELETE /api/contact/:id
 * @access  Private/Admin
 */
exports.deleteContactMessage = async (req, res, next) => {
  try {
    const ContactMessage = require('../models/ContactMessage');
    const message = await ContactMessage.findByIdAndDelete(req.params.id);
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Contact message not found'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Contact message deleted successfully'
    });
  } catch (error) {
    logger.error(`Error deleting contact message: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to delete contact message',
      error: error.message
    });
  }
};

/**
 * @desc    Reply to a contact message
 * @route   POST /api/contact/:id/reply
 * @access  Private/Admin
 */
exports.replyToContactMessage = async (req, res, next) => {
  try {
    const ContactMessage = require('../models/ContactMessage');
    const { subject, message } = req.body;
    
    // Basic validation
    if (!subject || !message) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both subject and message'
      });
    }
    
    // Find the contact message
    const contactMessage = await ContactMessage.findById(req.params.id);
    
    if (!contactMessage) {
      return res.status(404).json({
        success: false,
        message: 'Contact message not found'
      });
    }
    
    // Check if FROM_EMAIL is defined
    if (!process.env.FROM_EMAIL) {
      logger.error("FROM_EMAIL is not defined in environment variables");
      return res.status(500).json({
        success: false,
        message: "Server configuration error: From email not set",
      });
    }
    
    // Load and compile the reply email template
    const templatePath = path.join(__dirname, "../templates/contactReply.html");
    if (!fs.existsSync(templatePath)) {
      // If template doesn't exist, create a basic one
      const basicTemplate = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4f46e5; color: white; padding: 10px 20px; }
          .content { padding: 20px; background-color: #f9fafb; }
          .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>{{companyName}}</h2>
          </div>
          <div class="content">
            <p>Hello {{name}},</p>
            <div>{{message}}</div>
            <p>Best regards,<br>The {{companyName}} Team</p>
          </div>
          <div class="footer">
            <p>© {{year}} {{companyName}}. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
      `;
      fs.writeFileSync(templatePath, basicTemplate);
      logger.info(`Created basic contact reply template at ${templatePath}`);
    }
    
    const templateSource = fs.readFileSync(templatePath, "utf8");
    const template = handlebars.compile(templateSource);
    
    // Format the message with proper HTML paragraphs
    // Ensure message is properly formatted with strong styling for better visibility
    const formattedMessage = message
      .split('\n\n')
      .map(paragraph => `<p style="margin-bottom: 10px; font-size: 16px;">${paragraph.replace(/\n/g, '<br>')}</p>`)
      .join('');
      
    const htmlContent = template({
      name: contactMessage.name,
      message: formattedMessage,
      companyName: process.env.COMPANY_NAME || '10X Energy Drink',
      year: new Date().getFullYear()
    });
    
    const plainTextMessage = message;
    
    await sendEmail({
      email: contactMessage.email,
      subject: subject,
      message: plainTextMessage,
      html: htmlContent,
    });
    
    // Update message status to resolved (since 'replied' is not a valid enum value)
    contactMessage.status = 'resolved';
    contactMessage.repliedAt = Date.now();
    await contactMessage.save();
    
    logger.info(`Reply sent to ${contactMessage.email}`);
    
    res.status(200).json({
      success: true,
      message: 'Reply sent successfully'
    });
  } catch (error) {
    logger.error(`Error replying to contact message: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to send reply',
      error: error.message
    });
  }
};
