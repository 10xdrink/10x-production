const Influencer = require('../models/Influencer');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const sendEmail = require('../utils/sendEmail');
const logger = require('../utils/logger');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');
const { generatePDF } = require('../utils/generatePDF');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('express-async-handler');

/**
 * @desc    Submit a new influencer application
 * @route   POST /api/influencers/apply
 * @access  Public
 */
exports.submitApplication = async (req, res) => {
  try {
    const {
      fullName,
      email,
      whatsapp,
      contactPreference,
      platforms,
      followers,
      niche,
      instagram,
      youtube,
      tiktok,
      website,
      podcast,
      experience,
      goals,
      why,
      availability
    } = req.body;

    // Check if application already exists
    const existingApplication = await Influencer.findOne({ email });
    if (existingApplication) {
      return res.status(400).json({
        success: false,
        message: 'You have already submitted an application with this email'
      });
    }

    // Create new application
    const application = await Influencer.create({
      fullName,
      email,
      whatsapp,
      contactPreference,
      platforms,
      followers,
      niche,
      instagram,
      youtube,
      tiktok,
      website,
      podcast,
      experience,
      goals,
      why,
      availability,
      status: 'pending',
      applicationDate: Date.now()
    });

    // Send confirmation email to applicant
    const templatePath = path.join(__dirname, '../templates/applicationConfirmation.html');
    // Fallback if template doesn't exist
    let htmlContent = `
      <h2>Application Received</h2>
      <p>Hello ${fullName},</p>
      <p>Thank you for applying to become a 10X Partner. We have received your application and will review it within 48 hours.</p>
      <p>We'll notify you via your preferred contact method (${contactPreference}) once our team has made a decision.</p>
      <p>Thank you for your interest in partnering with us!</p>
      <p>Best regards,<br>The 10X Team</p>
    `;

    // Use template if it exists
    if (fs.existsSync(templatePath)) {
      const templateSource = fs.readFileSync(templatePath, 'utf8');
      const template = handlebars.compile(templateSource);
      htmlContent = template({
        name: fullName,
        contactMethod: contactPreference
      });
    }

    await sendEmail({
      email,
      subject: '10X Partner Application Received',
      message: `Thank you for applying to become a 10X Partner. We have received your application and will review it within 48 hours.`,
      html: htmlContent
    });

    // Send notification to admins
    const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',') : [];
    if (adminEmails.length > 0) {
      const adminNotificationTemplate = `
        <h2>New Influencer Application</h2>
        <p>A new influencer application has been submitted:</p>
        <ul>
          <li><strong>Name:</strong> ${fullName}</li>
          <li><strong>Email:</strong> ${email}</li>
          <li><strong>Platforms:</strong> ${platforms.join(', ')}</li>
          <li><strong>Followers:</strong> ${followers}</li>
          <li><strong>Niche:</strong> ${niche}</li>
        </ul>
        <p>Please review this application at your earliest convenience.</p>
      `;

      for (const adminEmail of adminEmails) {
        await sendEmail({
          email: adminEmail.trim(),
          subject: 'New 10X Partner Application',
          message: `A new influencer application has been submitted by ${fullName}. Please review.`,
          html: adminNotificationTemplate
        });
      }
    }

    logger.info(`New influencer application submitted: ${email}`);

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully!',
      data: application
    });
  } catch (error) {
    logger.error(`Error submitting influencer application: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'An error occurred while submitting your application.'
    });
  }
};

/**
 * @desc    Get all influencer applications
 * @route   GET /api/influencers
 * @access  Private/Admin
 */
exports.getApplications = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 10 } = req.query;
    
    // Build query
    const query = {};
    
    // Filter by status if provided
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      query.status = status;
    }
    
    // Search by name or email
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { niche: { $regex: search, $options: 'i' } }
      ];
    }

    // Count total documents for pagination
    const total = await Influencer.countDocuments(query);
    
    // Get paginated results
    const applications = await Influencer
      .find(query)
      .sort({ applicationDate: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('reviewedBy', 'name email');
    
    res.status(200).json({
      success: true,
      count: applications.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      data: applications
    });
  } catch (error) {
    logger.error(`Error fetching influencer applications: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching applications.'
    });
  }
};

/**
 * @desc    Get a single influencer application
 * @route   GET /api/influencers/:id
 * @access  Private/Admin
 */
exports.getApplication = async (req, res) => {
  try {
    const application = await Influencer.findById(req.params.id)
      .populate('reviewedBy', 'name email')
      .populate('user', 'name email');
    
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: application
    });
  } catch (error) {
    logger.error(`Error fetching influencer application: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching the application.'
    });
  }
};

/**
 * @desc    Review an influencer application (approve or reject)
 * @route   PUT /api/influencers/:id/review
 * @access  Private/Admin
 */
exports.reviewApplication = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { status, rejectionReason } = req.body;

  // Find application
  const application = await Influencer.findById(id);

  if (!application) {
    return next(new ErrorResponse('Application not found', 404));
  }

  // Check if application is already reviewed
  if (application.status !== 'pending') {
    return next(new ErrorResponse('Application has already been reviewed', 400));
  }

  // Update application status
  application.status = status;
  application.reviewedBy = req.user.id;
  application.reviewDate = Date.now();
  
  if (status === 'rejected' && rejectionReason) {
    application.rejectionReason = rejectionReason;
  }

  await application.save();
  logger.info(`Application status updated to ${status} for ${application.email}`);

  // If approved, create influencer user account
  if (status === 'approved') {
    try {
      // Generate temporary password if needed
      const tempPassword = null; // Set to null to require setup

      // Create influencer user account
      const user = await exports.createInfluencerAccount(application, tempPassword);
      logger.info(`Successfully created/retrieved user account with ID: ${user._id} for influencer: ${application.email}`);
      
      // Double-check that our application has been updated with the user reference
      const updatedApplication = await Influencer.findById(id);
      if (!updatedApplication.user) {
        logger.error(`User reference missing from application after user creation. Setting it now.`);
        updatedApplication.user = user._id;
        await updatedApplication.save();
      }
      
      // Send approval email with login instructions
      await sendEmail({
        email: application.email,
        subject: 'Your 10X Influencer Application Has Been Approved!',
        message: `
          <h1>Congratulations!</h1>
          <p>Dear ${application.fullName},</p>
          <p>We're excited to inform you that your application to join the 10X Influencer Platform has been approved!</p>
          <p>To get started, please visit our platform to complete your account setup:</p>
          <p><a href="${process.env.INFLUENCER_URL || 'http://localhost:3000'}/login" style="padding: 10px 15px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 5px;">Complete Your Account Setup</a></p>
          <p>Login using your email: <strong>${application.email}</strong></p>
          <p>You'll be guided through setting up your password and completing your profile.</p>
          <p>Welcome to the 10X Influencer family!</p>
          <p>Best regards,<br>The 10X Team</p>
        `
      });
      
      logger.info(`Approval email sent to ${application.email}`);
    } catch (error) {
      logger.error(`Error in creating influencer account: ${error.message}`, { 
        error, 
        applicationId: application._id,
        email: application.email 
      });
      // Still return success but log the error
    }
  } else if (status === 'rejected') {
    // Send rejection email
    try {
      await sendEmail({
        email: application.email,
        subject: 'Update on Your 10X Influencer Application',
        message: `
          <h2>Application Update</h2>
          <p>Dear ${application.fullName},</p>
          <p>Thank you for your interest in the 10X Influencer Platform. After careful review of your application, we regret to inform you that we are unable to approve your application at this time.</p>
          ${rejectionReason ? `<p><strong>Reason:</strong> ${rejectionReason}</p>` : ''}
          <p>We encourage you to consider the following before reapplying in the future:</p>
          <ul>
            <li>Building a stronger presence on your chosen platforms</li>
            <li>Creating more content in your niche</li>
            <li>Increasing engagement with your audience</li>
          </ul>
          <p>You may reapply after 3 months with updated information.</p>
          <p>Best regards,<br>The 10X Team</p>
        `
      });
      logger.info(`Rejection email sent to ${application.email}`);
    } catch (error) {
      logger.error(`Error sending rejection email: ${error.message}`);
    }
  }

  res.status(200).json({
    success: true,
    data: application,
    message: `Application ${status} successfully`
  });
});

/**
 * @desc    Get dashboard stats for influencers
 * @route   GET /api/influencers/stats
 * @access  Private/Admin
 */
exports.getInfluencerStats = async (req, res) => {
  try {
    // Get counts by status
    const pending = await Influencer.countDocuments({ status: 'pending' });
    const approved = await Influencer.countDocuments({ status: 'approved' });
    const rejected = await Influencer.countDocuments({ status: 'rejected' });
    const total = pending + approved + rejected;
    
    // Get platform distribution
    const platforms = await Influencer.aggregate([
      { $unwind: '$platforms' },
      { $group: { _id: '$platforms', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    // Get follower range distribution
    const followers = await Influencer.aggregate([
      { $group: { _id: '$followers', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    // Get recent applications (last 5)
    const recentApplications = await Influencer
      .find()
      .sort({ applicationDate: -1 })
      .limit(5)
      .select('fullName email platforms followers status applicationDate');
    
    res.status(200).json({
      success: true,
      data: {
        counts: { pending, approved, rejected, total },
        platforms,
        followers,
        recentApplications
      }
    });
  } catch (error) {
    logger.error(`Error fetching influencer stats: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching influencer statistics.'
    });
  }
};

/**
 * @desc    Resend credentials to an approved influencer
 * @route   POST /api/influencers/:id/resend-credentials
 * @access  Private/Admin
 */
exports.resendCredentials = async (req, res) => {
  try {
    const application = await Influencer.findById(req.params.id);
    
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }
    
    if (application.status !== 'approved' || !application.user) {
      return res.status(400).json({
        success: false,
        message: 'This application has not been approved or does not have associated credentials.'
      });
    }
    
    // If credentials file is missing, regenerate it
    if (!application.credentials || !application.credentials.filePath || !fs.existsSync(application.credentials.filePath)) {
      logger.info(`Credentials file not found for ${application.email}, regenerating...`);
      
      // Check if we have a password stored
      let password = application.credentials?.password;
      
      // If not, generate a new password
      if (!password) {
        password = crypto.randomBytes(10).toString('hex');
        application.credentials = application.credentials || {};
        application.credentials.password = password;
      }
      
      // Generate a new PDF
      const credentialsDir = path.join(__dirname, '../credentials');
      if (!fs.existsSync(credentialsDir)) {
        fs.mkdirSync(credentialsDir, { recursive: true });
      }
      
      const credentialsFilePath = path.join(credentialsDir, `${application._id}_credentials.pdf`);
      
      // Generate PDF content
      const pdfContent = {
        title: '10X Partner Account Credentials',
        name: application.fullName,
        email: application.email,
        password: password,
        loginUrl: `${process.env.FRONTEND_URL}/partner/login`
      };
      
      // Generate the PDF
      await generatePDF(pdfContent, credentialsFilePath);
      
      // Save the file path
      application.credentials.filePath = credentialsFilePath;
      await application.save();
      
      logger.info(`Regenerated credentials file for ${application.email}`);
    }
    
    // Send the credentials email again
    const templatePath = path.join(__dirname, '../templates/resendCredentials.html');
    // Fallback if template doesn't exist
    let htmlContent = `
      <h2>Your 10X Partner Account Credentials</h2>
      <p>Hello ${application.fullName},</p>
      <p>As requested, we're resending your 10X Partner account credentials.</p>
      <p>Please find your login information in the attached file.</p>
      <p><strong>Email:</strong> ${application.email}</p>
      <p>We recommend changing your password after logging in for security reasons.</p>
      <p>Best regards,<br>The 10X Team</p>
    `;

    // Use template if it exists
    if (fs.existsSync(templatePath)) {
      const templateSource = fs.readFileSync(templatePath, 'utf8');
      const template = handlebars.compile(templateSource);
      htmlContent = template({
        name: application.fullName,
        email: application.email
      });
    }

    await sendEmail({
      email: application.email,
      subject: '10X Partner Credentials (Resent)',
      message: `Your 10X Partner account credentials have been resent. Please find them in the attached file.`,
      html: htmlContent,
      attachments: [
        {
          filename: '10X_Partner_Credentials.pdf',
          path: application.credentials.filePath
        }
      ]
    });
    
    logger.info(`Credentials resent to influencer: ${application.email}`);
    
    res.status(200).json({
      success: true,
      message: 'Credentials resent successfully'
    });
  } catch (error) {
    logger.error(`Error resending credentials: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'An error occurred while resending credentials.'
    });
  }
};

/**
 * @desc    Get all approved influencer partners
 * @route   GET /api/influencers/partners
 * @access  Private/Admin
 */
exports.getPartners = async (req, res) => {
  try {
    const { platform, search, followers, page = 1, limit = 12 } = req.query;
    
    // Build query - only get approved applications
    // Modified to first get all approved applications regardless of user reference
    const query = { 
      status: 'approved'
    };
    
    // Filter by platform if provided
    if (platform && platform !== 'all') {
      query.platforms = platform;
    }
    
    // Filter by follower range if provided
    if (followers && followers !== 'all') {
      query.followers = followers;
    }
    
    // Search by name, email or niche
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { niche: { $regex: search, $options: 'i' } }
      ];
    }

    // Log the query being executed
    logger.info(`Executing partners query: ${JSON.stringify(query)}`);

    // Count total documents for pagination
    const total = await Influencer.countDocuments(query);
    logger.info(`Found ${total} total approved applications`);
    
    // Get paginated results
    const partners = await Influencer
      .find(query)
      .sort({ reviewDate: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('user', 'name email isActive');
    
    // Log more diagnostic information
    const partnersWithUsers = partners.filter(p => p.user);
    logger.info(`Partners with user accounts: ${partnersWithUsers.length} out of ${partners.length}`);
    
    // If we're not finding any partners with user accounts, check if any users exist
    if (partnersWithUsers.length === 0) {
      const InfluencerUser = require('../models/InfluencerUser');
      const totalUsers = await InfluencerUser.countDocuments();
      logger.info(`Total InfluencerUser records: ${totalUsers}`);
      
      // If there are users but they're not linked, try to repair some links
      if (totalUsers > 0 && partners.length > 0) {
        logger.info('Attempting to repair user-application links...');
        
        // For each approved influencer without a user link, try to find a matching user
        for (const partner of partners.filter(p => !p.user)) {
          const matchingUser = await InfluencerUser.findOne({ email: partner.email });
          if (matchingUser) {
            partner.user = matchingUser._id;
            await partner.save();
            logger.info(`Repaired link for ${partner.email}`);
          }
        }
        
        // Reload partners after repairs
        const repairedPartners = await Influencer
          .find(query)
          .sort({ reviewDate: -1 })
          .skip((page - 1) * limit)
          .limit(parseInt(limit))
          .populate('user', 'name email isActive');
          
        logger.info(`After repair: Partners with users: ${repairedPartners.filter(p => p.user).length} out of ${repairedPartners.length}`);
        
        // Use the repaired list
        res.status(200).json({
          success: true,
          count: repairedPartners.length,
          total,
          totalPages: Math.ceil(total / limit),
          currentPage: parseInt(page),
          data: repairedPartners
        });
        return;
      }
    }
    
    res.status(200).json({
      success: true,
      count: partners.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      data: partners
    });
  } catch (error) {
    logger.error(`Error fetching influencer partners: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching partners.'
    });
  }
};

/**
 * @desc    Delete an influencer application
 * @route   DELETE /api/influencers/:id
 * @access  Private/Admin
 */
exports.deleteApplication = async (req, res) => {
  try {
    const application = await Influencer.findById(req.params.id);
    
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }
    
    // If application has credentials PDF, delete it
    if (application.credentials && application.credentials.filePath) {
      if (fs.existsSync(application.credentials.filePath)) {
        fs.unlinkSync(application.credentials.filePath);
        logger.info(`Deleted credentials file for application: ${application.email}`);
      }
    }
    
    // Send application deletion notification email
    try {
      const fs = require('fs');
      const path = require('path');
      const handlebars = require('handlebars');
      const sendEmail = require('../utils/sendEmail');
      
      // Prepare email content
      let htmlContent;
      const templatePath = path.join(__dirname, '../templates/accountDeletion.html');
      
      // Use template if it exists, otherwise use fallback HTML
      if (fs.existsSync(templatePath)) {
        const templateSource = fs.readFileSync(templatePath, 'utf8');
        const template = handlebars.compile(templateSource);
        htmlContent = template({
          name: application.fullName || 'Partner',
          supportUrl: process.env.SUPPORT_URL || 'https://10xformulas.com/contact'
        });
      } else {
        // Fallback HTML content
        htmlContent = `
          <h2>Application Deletion Notification</h2>
          <p>Hello ${application.fullName || 'Partner'},</p>
          <p>We're writing to inform you that your 10X Partner application has been removed from our system by an administrator.</p>
          <p>If you believe this was done in error or have any questions, please contact our support team.</p>
          <p>Thank you,<br>The 10X Team</p>
        `;
      }
      
      await sendEmail({
        email: application.email,
        subject: '10X Partner Application Removed',
        message: `Your 10X Partner application has been removed from our system. If you believe this was done in error, please contact our support team.`,
        html: htmlContent
      });
      
      logger.info(`Sent application deletion notification email to: ${application.email}`);
    } catch (emailError) {
      // Log email error but continue with deletion process
      logger.error(`Failed to send application deletion email to ${application.email}: ${emailError.message}`);
    }
    
    // Delete the application
    await Influencer.findByIdAndDelete(req.params.id);
    
    // Log the deletion in audit log
    await AuditLog.logAction(
      'Influencer',
      'DELETE',
      application._id,
      { email: application.email, fullName: application.fullName },
      req.user.id,
      `Deleted influencer application for ${application.email}`
    );
    
    logger.info(`Influencer application deleted: ${application.email}`);
    
    res.status(200).json({
      success: true,
      message: 'Application deleted successfully'
    });
  } catch (error) {
    logger.error(`Error deleting influencer application: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'An error occurred while deleting the application.'
    });
  }
};

/**
 * Create influencer user account after application approval
 * @param {Object} application - The approved influencer application
 * @param {String} tempPassword - Temporary password if generated
 * @returns {Promise<Object>} Newly created influencer user
 */
exports.createInfluencerAccount = async (application, tempPassword = null) => {
  try {
    // Import the InfluencerUser model
    const InfluencerUser = require('../models/InfluencerUser');
    
    // Check if user already exists
    const existingUser = await InfluencerUser.findOne({ email: application.email });
    
    if (existingUser) {
      logger.warn(`Attempted to create duplicate influencer account for ${application.email}`);
      
      // Important fix: Make sure the application is linked to the user
      if (!application.user || !application.user.equals(existingUser._id)) {
        application.user = existingUser._id;
        await application.save();
        logger.info(`Linked existing user to application for ${application.email}`);
      }
      
      return existingUser;
    }
    
    // Log detailed info before creating user
    logger.info(`Creating influencer user account for application: ${application._id}, ${application.fullName}, ${application.email}`);
    
    // Create the influencer user
    const user = await InfluencerUser.create({
      email: application.email,
      name: application.fullName,
      applicationId: application._id,
      // If temporary password is provided, set it
      ...(tempPassword && { password: tempPassword }),
      role: 'influencer',
      setupCompleted: false,
      setupSteps: {
        password: false,
        socials: false,
        payment: false,
        verification: false
      }
    });
    
    logger.info(`Successfully created InfluencerUser with ID: ${user._id}`);
    
    // Update the application to link it to the user
    application.user = user._id;
    await application.save();
    
    logger.info(`Successfully linked user ${user._id} to application ${application._id}`);
    
    // Double-check that our reference was saved correctly
    const updatedApplication = await Influencer.findById(application._id);
    if (!updatedApplication.user || !updatedApplication.user.equals(user._id)) {
      logger.error(`Failed to save user reference to application. Expected: ${user._id}, Actual: ${updatedApplication.user}`);
      
      // Try to save again if it failed
      updatedApplication.user = user._id;
      await updatedApplication.save();
      logger.info(`Re-attempted to save user reference: ${user._id} to application ${application._id}`);
    }
    
    logger.info(`Created influencer account for ${application.email}`);
    return user;
  } catch (error) {
    logger.error(`Error creating influencer account: ${error.message}`, { 
      error,
      application: {
        id: application._id, 
        email: application.email
      }
    });
    throw error;
  }
};

/**
 * @desc    Delete an influencer user and their application
 * @route   DELETE /api/influencers/user/:id
 * @access  Private/Admin
 */
exports.deleteInfluencerUser = async (req, res) => {
  try {
    // Import models
    const InfluencerUser = require('../models/InfluencerUser');
    const AuditLog = require('../models/AuditLog');
    
    // Find the influencer user
    const user = await InfluencerUser.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Influencer user not found'
      });
    }
    
    // Find the related application
    const application = await Influencer.findOne({ user: user._id });
    
    // Store user data for audit log
    const userData = {
      email: user.email,
      name: user.name,
      applicationId: user.applicationId
    };
    
    // Send account deletion notification email
    try {
      const fs = require('fs');
      const path = require('path');
      const handlebars = require('handlebars');
      const sendEmail = require('../utils/sendEmail');
      
      // Prepare email content
      let htmlContent;
      const templatePath = path.join(__dirname, '../templates/accountDeletion.html');
      
      // Use template if it exists, otherwise use fallback HTML
      if (fs.existsSync(templatePath)) {
        const templateSource = fs.readFileSync(templatePath, 'utf8');
        const template = handlebars.compile(templateSource);
        htmlContent = template({
          name: user.name || 'Partner',
          deleteUrl: '#', // No action URL needed as account is already deleted
          supportUrl: process.env.SUPPORT_URL || 'https://10xformulas.com/contact'
        });
      } else {
        // Fallback HTML content
        htmlContent = `
          <h2>Account Deletion Notification</h2>
          <p>Hello ${user.name || 'Partner'},</p>
          <p>We're writing to inform you that your 10X Partner account has been deleted by an administrator.</p>
          <p>If you believe this was done in error or have any questions, please contact our support team.</p>
          <p>Thank you,<br>The 10X Team</p>
        `;
      }
      
      await sendEmail({
        email: user.email,
        subject: '10X Partner Account Deleted',
        message: `Your 10X Partner account has been deleted by an administrator. If you believe this was done in error, please contact our support team.`,
        html: htmlContent
      });
      
      logger.info(`Sent account deletion notification email to: ${user.email}`);
    } catch (emailError) {
      // Log email error but continue with deletion process
      logger.error(`Failed to send account deletion email to ${user.email}: ${emailError.message}`);
    }
    
    // Delete the influencer user
    await InfluencerUser.findByIdAndDelete(user._id);
    logger.info(`Deleted influencer user account: ${user.email}`);
    
    // If there's a related application, update it to remove the user reference
    if (application) {
      application.user = undefined;
      application.status = 'rejected'; // Set status to rejected since the user was deleted
      application.rejectionReason = 'User account deleted by admin';
      await application.save();
      logger.info(`Updated application status after user deletion: ${application.email}`);
    }
    
    // Log the deletion in audit log
    try {
      await AuditLog.logAction(
        'InfluencerUser',
        'DELETE',
        user._id,
        userData,
        req.user.id,
        `Deleted influencer user account for ${user.email}`
      );
    } catch (auditError) {
      // Log the audit error but don't fail the deletion operation
      logger.error(`Error logging audit for user deletion: ${auditError.message}`, { error: auditError });
    }
    
    res.status(200).json({
      success: true,
      message: 'Influencer user deleted successfully'
    });
  } catch (error) {
    logger.error(`Error deleting influencer user: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'An error occurred while deleting the influencer user.'
    });
  }
}; 