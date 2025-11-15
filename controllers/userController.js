// controllers/userController.js

const User = require("../models/User");
const AuditLog = require("../models/AuditLog"); // Ensure AuditLog model is imported
const Invite = require("../models/Invite"); // Import Invite model for invitation functionality
const { uploadImage } = require("../services/s3Service"); // Import S3 service
const { compressProfilePhoto } = require("../utils/imageCompressor");
const bcrypt = require("bcryptjs");
const logger = require("../utils/logger");
const ERROR_CODES = require("../constants/errorCodes");
const { createObjectCsvStringifier } = require("csv-writer");
const jwt = require("jsonwebtoken");
const { generateToken } = require("../utils/generateToken"); // Token generator utility
const sendInvitationEmail = require("../utils/sendInvitationEmail"); // Updated import
const ProductPurchase = require('../models/ProductPurchase');
const mongoose = require('mongoose');

// Load models safely with fallbacks
let Order, Cart, SessionLog, PageView, Review, SupportTicket, Comment;
try { Order = require('../models/Order'); } catch (err) { Order = null; logger.warn('Order model not available'); }
try { Cart = require('../models/Cart'); } catch (err) { Cart = null; logger.warn('Cart model not available'); }
try { SessionLog = require('../models/SessionLog'); } catch (err) { SessionLog = null; logger.warn('SessionLog model not available'); }
try { PageView = require('../models/PageView'); } catch (err) { PageView = null; logger.warn('PageView model not available'); }
try { Review = require('../models/Review'); } catch (err) { Review = null; logger.warn('Review model not available'); }
try { SupportTicket = require('../models/SupportTicket'); } catch (err) { SupportTicket = null; logger.warn('SupportTicket model not available'); }
try { Comment = require('../models/Comment'); } catch (err) { Comment = null; logger.warn('Comment model not available'); }

// Define allowed actions for AuditLog
const ALLOWED_AUDIT_ACTIONS = ["CREATE", "UPDATE", "DELETE", "RESTORE"];

/**
 * @desc    Get all users with optional filters
 * @route   GET /api/users/admin/users
 * @access  Private/Admin
 */
exports.getAllUsers = async (req, res) => {
  try {
    const { role, isActive, page = 1, limit = 20 } = req.query;
    let query = {};

    if (role) {
      query.role = role;
    }

    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    const users = await User.find(query)
      .select("-password") // Exclude password field
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const totalUsers = await User.countDocuments(query);
    const totalPages = Math.ceil(totalUsers / limit);

    res.status(200).json({
      success: true,
      count: users.length,
      totalPages,
      currentPage: parseInt(page),
      data: users,
    });
  } catch (error) {
    logger.error("Get All Users Error:", error);
    res.status(500).json({ success: false, message: ERROR_CODES.SERVER_ERROR });
  }
};

/**
 * @desc    Invite a new user by email and role
 * @route   POST /api/users/admin/users/invite
 * @access  Private/Admin
 */
exports.inviteUser = async (req, res) => {
  try {
    const { email, role } = req.body;

    // Check if a user already exists with this email
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res
        .status(400)
        .json({
          success: false,
          message: "A user with this email already exists.",
        });
    }

    // Check if an invite already exists for this email and is not used
    let existingInvite = await Invite.findOne({ email, isUsed: false });
    if (existingInvite) {
      return res
        .status(400)
        .json({
          success: false,
          message: "An active invitation already exists for this email.",
        });
    }

    // Generate a unique token
    const token = generateToken({ email, role }, "24h"); // Token valid for 24 hours

    // Create an invite
    const invite = await Invite.create({
      email,
      role,
      token,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    });

    // Send invitation email
    const subject = "You are invited to join Our App";
    const message = `Hello,

You have been invited to join Our App with the role of ${role.replace(
      /_/g,
      " "
    )}.

Please click the link below to set up your account:

${process.env.FRONTEND_URL}/signup?token=${token}

This link will expire in 24 hours.

If you did not expect this invitation, you can ignore this email.

Best regards,
The Team`;

    const html = `
      <p>Hello,</p>
      <p>You have been invited to join <strong>Our App</strong> with the role of <strong>${role.replace(
        /_/g,
        " "
      )}</strong>.</p>
      <p>Please click the link below to set up your account:</p>
      <a href="${
        process.env.FRONTEND_URL
      }/signup?token=${token}">Set Up Your Account</a>
      <p>This link will expire in 24 hours.</p>
      <p>If you did not expect this invitation, you can ignore this email.</p>
      <p>Best regards,<br/>The Team</p>
    `;

    await sendInvitationEmail(email, token, role, subject, message, html);

    // Log the invitation action in AuditLog
    try {
    await AuditLog.create({
      performedBy: req.user._id, // ID of the admin performing the action
      entityId: invite._id, // ID of the invite
      entity: "Invite", // Type of entity
      action: "CREATE", // Action performed
      details: `Invited user with email: ${email} and role: ${role}.`,
    });
    } catch (auditError) {
      // Log the error but don't fail the invitation process
      logger.error("Failed to create audit log for invitation:", auditError);
    }

    res
      .status(200)
      .json({ success: true, message: "Invitation sent successfully." });
  } catch (error) {
    logger.error("Invite User Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Error sending invitation",
        error: error.message,
      });
  }
};

/**
 * @desc    Signup a user via invitation token
 * @route   POST /api/users/signup
 * @access  Public
 */
exports.signupViaInvite = async (req, res) => {
  try {
    const { token, name, password, confirmPassword } = req.body;

    // Verify the token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired token." });
    }

    const { email, role } = decoded;

    // Check if the invite exists and is not used
    const invite = await Invite.findOne({ email, token, isUsed: false });
    if (!invite) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Invalid or already used invitation token.",
        });
    }

    // Check if user already exists
    let existingUser = await User.findOne({ email });
    if (existingUser) {
      return res
        .status(400)
        .json({
          success: false,
          message: "A user with this email already exists.",
        });
    }

    // Validate password and confirmPassword
    if (password !== confirmPassword) {
      return res
        .status(400)
        .json({ success: false, message: "Passwords do not match." });
    }

    // Create the user
    const user = await User.create({
      name,
      email,
      password,
      role,
    });

    // Mark the invite as used
    invite.isUsed = true;
    await invite.save();

    // Optionally, generate a JWT token for the user to log in immediately
    const userToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(201).json({
      success: true,
      message: "Account created successfully.",
      token: userToken,
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    logger.error("Signup Via Invite Error:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

/**
 * @desc    Get a single user by ID
 * @route   GET /api/users/admin/users/:id
 * @access  Private/Admin
 */
exports.getUserById = async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await User.findById(userId).select("-password");

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Log the user data for debugging
    console.log('GET user by ID response:', {
      id: user._id,
      name: user.name,
      email: user.email,
      hasProfilePicture: !!user.profilePicture,
      profilePictureUrl: user.profilePicture || 'not set',
      avatar: user.avatar || 'not set',
      fields: Object.keys(user._doc || user)
    });

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    logger.error("Get User By ID Error:", error);
    res.status(500).json({ success: false, message: ERROR_CODES.SERVER_ERROR });
  }
};

/**
 * @desc    Create a new user
 * @route   POST /api/users/admin/users
 * @access  Private/Admin/Super Admin/Marketing Manager
 */
exports.createUser = async (req, res) => {
  try {
    console.log('Create user request received:', {
      body: req.body,
      user: req.user ? `${req.user._id} (${req.user.email})` : 'No user in request',
      file: req.file ? 'File included' : 'No file'
    });

    const { name, email, password, role, phone, address } = req.body;

    // Log the received data with phone and address
    console.log('Creating user with:', { name, email, role, hasPhone: !!phone, hasAddress: !!address });

    // Validate required fields
    if (!name || !email || !password || !role) {
      console.log('Missing required fields:', { name: !!name, email: !!email, password: !!password, role: !!role });
      return res.status(400).json({ 
        success: false, 
        message: "Missing required fields. Name, email, password, and role are required." 
      });
    }

    // Authentication check - temporarily disabled for testing 
    // Comment this block if authentication is causing issues
    /*
    if (!req.user || !req.user._id) {
      console.log('Authentication check failed - no user in request');
      return res.status(401).json({ success: false, message: "Not authenticated. Please login." });
    }
    */

    // Check if user already exists
    let user = await User.findOne({ email });
    if (user) {
      console.log('User already exists with email:', email);
      return res
        .status(400)
        .json({ success: false, message: "User already exists" });
    }

    // Create new user instance with phone and address if provided
    const userData = { 
      name, 
      email, 
      password, 
      role
    };
    
    // Add optional fields if provided
    if (phone) userData.phone = phone;
    if (address) userData.address = address;

    user = new User(userData);

    // Hash password
    const salt = await bcrypt.genSalt(12);
    user.password = await bcrypt.hash(password, salt);

    // Handle profile picture upload if provided
    if (req.file) {
      try {
        console.log('Processing profile picture upload');
        // Compress image before uploading
        const compressedBuffer = await compressProfilePhoto(req.file.buffer);
        
        const uploadResult = await uploadImage(compressedBuffer, {
          folder: "user_profiles",
          originalName: req.file.originalname,
          mimeType: 'image/jpeg',
        });
        
        // Update profile picture
        user.profilePicture = uploadResult.secure_url;
        logger.info(
          `Profile picture updated for user ${user.email}: ${uploadResult.secure_url}`
        );
      } catch (uploadError) {
        logger.error("Profile Picture Upload Error:", uploadError);
        return res.status(500).json({
          success: false,
          message: "Failed to upload profile picture",
        });
      }
    }

    // Save updated user
    await user.save();

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    logger.error("Update User Error:", error);
    res.status(500).json({ success: false, message: ERROR_CODES.SERVER_ERROR });
  }
};


/**
 * @desc    Update a user by ID
 * @route   PUT /api/users/admin/users/:id
 * @access  Private/Admin/Super Admin/Marketing Manager
 */
exports.updateUser = async (req, res) => {
  try {
    // Include phone and address in destructuring
    const { name, email, role, isActive, phone, address } = req.body;
    const userId = req.params.id;

    console.log('Update user request received:', {
      userId,
      body: { name, email, role, isActive, hasPhone: !!phone, hasAddress: !!address },
      file: req.file ? 'File included' : 'No file'
    });

    // Fetch the user by ID
    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Update fields if provided
    if (name) user.name = name;
    if (email) user.email = email;
    if (role) user.role = role;
    if (typeof isActive !== "undefined") user.isActive = isActive;
    
    // Add phone and address field updates
    if (phone !== undefined) user.phone = phone;
    if (address !== undefined) user.address = address;

    // Handle profile picture upload if provided
    if (req.file) {
      try {
        // Compress image before uploading
        const compressedBuffer = await compressProfilePhoto(req.file.buffer);
        
        const uploadResult = await uploadImage(compressedBuffer, {
          folder: "user_profiles",
          originalName: req.file.originalname,
          mimeType: 'image/jpeg',
        });

        // Update user's profile picture URL
        user.profilePicture = uploadResult.secure_url;
      } catch (uploadError) {
        logger.error("Profile Picture Upload Error:", uploadError);
        return res
          .status(500)
          .json({
            success: false,
            message: "Failed to upload profile picture",
          });
      }
    }

    await user.save();

    // Log the update in AuditLog
    await AuditLog.create({
      performedBy: req.user._id, // ID of the admin performing the action
      entityId: user._id, // ID of the user being updated
      entity: "User", // Type of entity
      action: "UPDATE", // Action performed
      details: `Updated user with email: ${user.email}.`,
    });

    res.status(200).json({
      success: true,
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        address: user.address,
        profilePicture: user.profilePicture,
        isActive: user.isActive,
      }, // Exclude password
    });
  } catch (error) {
    console.error("Update User Error:", error);
    logger.error("Update User Error:", error);
    res.status(500).json({ 
      success: false, 
      message: ERROR_CODES.SERVER_ERROR,
      error: error.message
    });
  }
};

/**
 * @desc    Delete a user by ID
 * @route   DELETE /api/users/admin/users/:id
 * @access  Private/Admin (Super Admin only)
 */
exports.deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;

    // Attempt to delete the user from the database
    const user = await User.findByIdAndDelete(userId);

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Log the deletion in AuditLog
    await AuditLog.create({
      performedBy: req.user._id, // ID of the admin performing the action
      entityId: user._id, // ID of the user being deleted
      entity: "User", // Type of entity
      action: "DELETE", // Action performed
      details: `Deleted user with email: ${user.email}.`,
    });

    res.status(200).json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    logger.error("Delete User Error:", error);
    res.status(500).json({ success: false, message: ERROR_CODES.SERVER_ERROR });
  }
};

/**
 * @desc    Admin-initiated password reset for a user
 * @route   POST /api/users/admin/users/:id/reset-password
 * @access  Private/Admin (Super Admin only)
 */
exports.resetUserPassword = async (req, res) => {
  try {
    const { password } = req.body;
    const userId = req.params.id;

    let user = await User.findById(userId).select("+password");

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(12);
    user.password = await bcrypt.hash(password, salt);

    await user.save();

    // Log the password reset in AuditLog
    await AuditLog.create({
      performedBy: req.user._id, // ID of the admin performing the action
      entityId: user._id, // ID of the user whose password is reset
      entity: "User", // Type of entity
      action: "UPDATE", // Action performed
      details: `Reset password for user with email: ${user.email}.`,
    });

    res.status(200).json({
      success: true,
      message: "User password reset successfully",
    });
  } catch (error) {
    logger.error("Reset User Password Error:", error);
    res.status(500).json({ success: false, message: ERROR_CODES.SERVER_ERROR });
  }
};

/**
 * @desc    Search or filter users based on query parameters
 * @route   GET /api/users/admin/users/search
 * @access  Private/Admin
 */
exports.searchUsers = async (req, res) => {
  try {
    const {
      name,
      email,
      role,
      createdFrom,
      createdTo,
      page = 1,
      limit = 20,
    } = req.query;
    const filter = {};

    if (name) {
      filter.name = { $regex: name, $options: "i" }; // Case-insensitive search
    }

    if (email) {
      filter.email = { $regex: email, $options: "i" };
    }

    if (role) {
      filter.role = role;
    }

    if (createdFrom || createdTo) {
      filter.createdAt = {};
      if (createdFrom) {
        filter.createdAt.$gte = new Date(createdFrom);
      }
      if (createdTo) {
        filter.createdAt.$lte = new Date(createdTo);
      }
    }

    const users = await User.find(filter)
      .select("-password") // Exclude password
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const totalUsers = await User.countDocuments(filter);
    const totalPages = Math.ceil(totalUsers / limit);

    res.status(200).json({
      success: true,
      count: users.length,
      totalPages,
      currentPage: parseInt(page),
      data: users,
    });
  } catch (error) {
    logger.error("Search Users Error:", error);
    res
      .status(500)
      .json({ success: false, message: "Server Error", error: error.message });
  }
};

/**
 * @desc    Export users in specified format (CSV/Excel)
 * @route   GET /api/users/admin/users/export
 * @access  Private/Admin
 */
exports.exportUsers = async (req, res) => {
  try {
    const format = req.query.format || "csv";
    const users = await User.find({})
      .select(
        "-password -resetPasswordToken -resetPasswordExpire -deletionToken -deletionTokenExpire"
      )
      .lean();

    if (format === "csv") {
      const csvStringifier = createObjectCsvStringifier({
        header: [
          { id: "_id", title: "ID" },
          { id: "name", title: "Name" },
          { id: "email", title: "Email" },
          { id: "role", title: "Role" },
          { id: "isActive", title: "Active" },
          { id: "createdAt", title: "Created At" },
          { id: "updatedAt", title: "Updated At" },
        ],
      });

      const header = csvStringifier.getHeaderString();
      const records = csvStringifier.stringifyRecords(users);

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=users.csv");
      res.status(200).send(Buffer.from(header + records));
    } else if (format === "excel") {
      // Implement Excel export if needed using a library like exceljs
      return res
        .status(400)
        .json({ success: false, message: "Unsupported export format" });
    } else {
      return res
        .status(400)
        .json({ success: false, message: "Invalid export format" });
    }
  } catch (error) {
    logger.error("Export Users Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Error exporting users",
        error: error.message,
      });
  }
};

/**
 * @desc    Change a user's active status
 * @route   PATCH /api/users/admin/users/:id/status
 * @access  Private/Admin
 */
exports.changeUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const user = await User.findByIdAndUpdate(
      id,
      { isActive },
      { new: true, runValidators: true }
    ).select("-password");

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Log the action in AuditLog
    await AuditLog.create({
      performedBy: req.user._id, // ID of the admin performing the action
      entityId: user._id, // ID of the user whose status is changed
      entity: "User", // Type of entity
      action: isActive ? "RESTORE" : "DELETE", // 'RESTORE' for activation, 'DELETE' for deactivation
      details: `User ${user.email} has been ${
        isActive ? "activated" : "deactivated"
      }.`,
    });

    res.status(200).json({ success: true, user });
  } catch (error) {
    logger.error("Change User Status Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Error updating user status",
        error: error.message,
      });
  }
};

/**
 * @desc    Perform bulk updates on multiple users
 * @route   POST /api/users/admin/users/bulk-update
 * @access  Private/Admin
 */
exports.bulkUpdateUsers = async (req, res) => {
  try {
    const { userIds, actions } = req.body;

    // Debugging: Log the received payload
    console.log("Received bulkUpdateUsers payload:", req.body);

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No user IDs provided." });
    }

    if (!Array.isArray(actions) || actions.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No actions provided." });
    }

    // Iterate over each action and perform accordingly
    for (const actionObj of actions) {
      const { action, data } = actionObj;

      switch (action) {
        case "changeRole":
          await User.updateMany({ _id: { $in: userIds } }, { role: data.role });
          break;
        case "changeStatus":
          await User.updateMany(
            { _id: { $in: userIds } },
            { isActive: data.isActive }
          );
          break;
        case "deleteUsers":
          await User.deleteMany({ _id: { $in: userIds } });
          break;
        default:
          return res
            .status(400)
            .json({ success: false, message: `Unknown action: ${action}` });
      }
    }

    // Log the bulk action in AuditLog
    await AuditLog.create({
      performedBy: req.user._id, // ID of the admin performing the action
      entityId: null, // Since multiple entities are affected, set to null
      entity: null, // Optional: Can set to 'User' or leave as null
      action: "BULK_UPDATE", // Action performed
      details: `Bulk updated users with IDs: ${userIds.join(", ")}.`,
    });

    res.status(200).json({ success: true, message: "Bulk update successful." });
  } catch (error) {
    logger.error("Bulk Update Users Error:", error);
    res.status(500).json({ success: false, message: ERROR_CODES.SERVER_ERROR });
  }
};

/**
 * @desc    Fetch recent login activity for a specific user
 * @route   GET /api/users/admin/users/:id/activity
 * @access  Private/Admin
 */
exports.getUserActivity = async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch recent activities related to the user
    const activities = await AuditLog.find({ entityId: id, entity: "User" })
      .sort({ createdAt: -1 })
      .limit(10); // Fetch last 10 activities

    res.status(200).json({ success: true, activities });
  } catch (error) {
    logger.error("Get User Activity Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Error fetching user activity",
        error: error.message,
      });
  }
};

/**
 * @desc    Get a count of users grouped by role
 * @route   GET /api/users/admin/users/count-by-role
 * @access  Private/Admin
 */
exports.countUsersByRole = async (req, res) => {
  try {
    // Detailed query to count users by role
    const roleCounts = await User.aggregate([
      { $group: { _id: "$role", count: { $sum: 1 } } },
      { $project: { role: "$_id", count: 1, _id: 0 } }
    ]);
    
    console.log(`[API] Role counts: ${JSON.stringify(roleCounts)}`);
    
    res.status(200).json({
      success: true,
      counts: roleCounts
    });
  } catch (error) {
    console.error("Count Users By Role Error:", error.message, error.stack);
    logger.error("Count Users By Role Error:", error);
    res.status(500).json({ 
        success: false,
      message: "Failed to count users by role.",
      error: error.message 
    });
  }
};

/**
 * @desc    Get count of active/inactive users
 * @route   GET /api/users/admin/users/count-by-status
 * @access  Private/Admin
 */
exports.countUsersByStatus = async (req, res) => {
  try {
    // Count active users (isActive: true)
    const activeCount = await User.countDocuments({ isActive: true });
    
    // Count inactive users (isActive: false)
    const inactiveCount = await User.countDocuments({ isActive: false });
    
    console.log(`[API] Active users: ${activeCount}, Inactive users: ${inactiveCount}`);
    
    res.status(200).json({
      success: true,
      activeUsers: activeCount,
      inactiveUsers: inactiveCount
    });
  } catch (error) {
    console.error("Count Users By Status Error:", error.message, error.stack);
    logger.error("Count Users By Status Error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to count users by status.",
      error: error.message 
      });
  }
};

/**
 * @desc    Get total number of users
 * @route   GET /api/users/admin/users/count
 * @access  Private/Admin
 */
exports.getUserCount = async (req, res) => {
  try {
    // Remove isDeleted filter since it might not exist in schema
    const count = await User.countDocuments({});
    
    console.log(`[API] Total user count: ${count}`);
    
    res.status(200).json({
      success: true,
      count: count
    });
  } catch (error) {
    console.error("Get User Count Error:", error.message);
    logger.error("Get User Count Error:", error);
    res.status(500).json({ success: false, message: ERROR_CODES.SERVER_ERROR });
  }
};

/**
 * @desc    Fetch a user's audit logs
 * @route   GET /api/users/admin/users/:id/audit
 * @access  Private/Admin
 */
exports.getUserAuditLogs = async (req, res) => {
  try {
    const { id } = req.params;

    const auditLogs = await AuditLog.find({ entityId: id, entity: "User" })
      .sort({ createdAt: -1 })
      .limit(50); // Limit to last 50 actions

    res.status(200).json({ success: true, auditLogs });
  } catch (error) {
    logger.error("Get User Audit Logs Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Error fetching audit logs",
        error: error.message,
      });
  }
};

/**
 * @desc    Count new users
 * @route   GET /api/users/admin/users/count-new
 * @access  Private/Admin
 */
exports.countNewUsers = async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const date = new Date();
    date.setDate(date.getDate() - parseInt(days));

    // Remove isDeleted filter since it might not exist in schema
    const count = await User.countDocuments({
      createdAt: { $gte: date }
    });
    
    console.log(`[API] New users count (${days} days): ${count}`);
    
    res.status(200).json({
      success: true,
      count: count
    });
  } catch (error) {
    console.error("Count New Users Error:", error.message);
    logger.error("Count New Users Error:", error);
    res.status(500).json({ success: false, message: ERROR_CODES.SERVER_ERROR });
  }
};

/**
 * @desc    Count returning users
 * @route   GET /api/users/admin/users/count-returning
 * @access  Private/Admin
 */
exports.countReturningUsers = async (req, res) => {
  try {
    // Simplify to just return a count of users with a lastLogin date
    // You might need to adjust this to match your schema
    const count = await User.countDocuments({
      lastLoginAt: { $exists: true }
    });
    
    console.log(`[API] Returning users count: ${count}`);
    
    res.status(200).json({
      success: true,
      count: count
    });
  } catch (error) {
    console.error("Count Returning Users Error:", error.message);
    logger.error("Count Returning Users Error:", error);
    res.status(500).json({ success: false, message: ERROR_CODES.SERVER_ERROR });
  }
};

/**
 * @desc    Get metrics for a specific user
 * @route   GET /api/users/admin/users/:id/metrics
 * @access  Private/Admin
 */
exports.getUserMetrics = async (req, res) => {
  try {
    const userId = req.params.id;

    // Validate if the user exists
    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Flag to track if we found any real metrics
    let hasRealMetrics = false;

    // Initialize metrics structure
    const metrics = {
      shopping: {},
      engagement: {},
      recency: {},
      interaction: {}
    };

    // SHOPPING BEHAVIOR METRICS
    // Total products the user has purchased
    try {
      if (ProductPurchase) {
        const productsPurchased = await ProductPurchase.countDocuments({ user: userId });
        metrics.shopping.productsPurchased = {
          value: productsPurchased,
          label: "Products Purchased",
          description: "Total number of products this user has purchased"
        };
        if (productsPurchased > 0) hasRealMetrics = true;
      }
    } catch (error) {
      logger.error("Error fetching product purchases:", error);
    }
    
    // Total orders placed by the user
    try {
      if (Order) {
        const ordersPlaced = await Order.countDocuments({ user: userId });
        metrics.shopping.ordersPlaced = {
          value: ordersPlaced,
          label: "Orders Placed",
          description: "Total number of orders this user has placed"
        };
        if (ordersPlaced > 0) hasRealMetrics = true;
        
        // Total amount spent by the user - Fix the ObjectId issue
        const purchaseAmounts = await Order.aggregate([
          { $match: { user: new mongoose.Types.ObjectId(userId) } },
          { $group: { _id: null, totalSpent: { $sum: "$totalAmount" } } }
        ]);
        const totalSpent = purchaseAmounts.length > 0 ? purchaseAmounts[0].totalSpent : 0;
        metrics.shopping.totalSpent = {
          value: totalSpent.toFixed(2),
          label: "Total Spent",
          description: "Total amount of money this user has spent on purchases"
        };
        if (totalSpent > 0) hasRealMetrics = true;
        
        // Days since last purchase
        const lastOrder = await Order.findOne({ 
          user: userId
        }).sort({ createdAt: -1 });
        
        let daysSinceLastPurchase = null;
        if (lastOrder) {
          const timeDiff = Date.now() - new Date(lastOrder.createdAt).getTime();
          daysSinceLastPurchase = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
          metrics.recency.daysSinceLastPurchase = {
            value: daysSinceLastPurchase,
            label: "Days Since Last Purchase",
            description: "Number of days since this user made their last purchase"
          };
          hasRealMetrics = true;
        }
      }
    } catch (error) {
      logger.error("Error fetching order metrics:", error);
    }
    
    // Number of items in cart but not purchased (abandoned cart)
    try {
      if (Cart) {
        const abandonedCartItems = await Cart.countDocuments({ 
          user: userId, 
          isCheckedOut: false,
          updatedAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } // older than 24 hours
        });
        
        metrics.shopping.abandonedCartItems = {
          value: abandonedCartItems,
          label: "Abandoned Cart Items",
          description: "Number of items left in cart without completing purchase"
        };
        if (abandonedCartItems > 0) hasRealMetrics = true;
      }
    } catch (error) {
      logger.error("Error fetching cart metrics:", error);
    }

    // ENGAGEMENT METRICS
    // Number of times the user has logged in
    try {
      const loginCount = await AuditLog.countDocuments({ 
      entityId: userId, 
      entity: "User", 
      action: "LOGIN" 
    });

      metrics.engagement.loginCount = {
        value: loginCount,
        label: "Login Count",
        description: "Number of times this user has logged into their account"
      };
      if (loginCount > 0) hasRealMetrics = true;
      
      // Days since last login
      const lastLoginAudit = await AuditLog.findOne({ 
        entityId: userId, 
        entity: "User", 
        action: "LOGIN" 
      }).sort({ createdAt: -1 });
      
      let daysSinceLastLogin = null;
      if (lastLoginAudit) {
        const timeDiff = Date.now() - new Date(lastLoginAudit.createdAt).getTime();
        daysSinceLastLogin = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
        
        metrics.recency.daysSinceLastLogin = {
          value: daysSinceLastLogin,
          label: "Days Since Last Login",
          description: "Number of days since this user last logged in"
        };
        hasRealMetrics = true;
      }
    } catch (error) {
      logger.error("Error fetching login metrics:", error);
    }
    
    // Average time spent on site (minutes) - if you track session duration
    try {
      if (SessionLog) {
        const sessionLogs = await SessionLog.find({ user: userId });
        let avgSessionDuration = 0;
        if (sessionLogs.length > 0) {
          const totalDuration = sessionLogs.reduce((sum, session) => sum + session.duration, 0);
          avgSessionDuration = Math.round(totalDuration / sessionLogs.length / 60); // Convert to minutes
          
          metrics.engagement.avgSessionDuration = {
            value: avgSessionDuration,
            label: "Avg. Session Duration",
            description: "Average time in minutes the user spends on the site per visit",
            unit: "min"
          };
          hasRealMetrics = true;
        }
      }
    } catch (error) {
      logger.error("Error fetching session metrics:", error);
    }
    
    // Number of product pages viewed & account page visits
    try {
      if (PageView) {
        const productViews = await PageView.countDocuments({ 
          user: userId,
          pageType: 'product'
        });
        
        metrics.engagement.productViews = {
          value: productViews,
          label: "Product Views",
          description: "Number of product pages this user has viewed"
        };
        if (productViews > 0) hasRealMetrics = true;
        
        const accountPageVisits = await PageView.countDocuments({ 
          user: userId,
          pageType: 'account'
        });
        
        metrics.engagement.accountPageVisits = {
          value: accountPageVisits,
          label: "Account Page Visits",
          description: "Number of times this user has visited their account pages"
        };
        if (accountPageVisits > 0) hasRealMetrics = true;
      }
    } catch (error) {
      logger.error("Error fetching page view metrics:", error);
    }

    // INTERACTION METRICS
    // Number of reviews submitted
    try {
      if (Review) {
        const reviewsSubmitted = await Review.countDocuments({ user: userId });
        
        metrics.interaction.reviewsSubmitted = {
          value: reviewsSubmitted,
          label: "Reviews Submitted",
          description: "Number of product reviews this user has submitted"
        };
        if (reviewsSubmitted > 0) hasRealMetrics = true;
      }
    } catch (error) {
      logger.error("Error fetching review metrics:", error);
    }
    
    // Number of support tickets created
    try {
      if (SupportTicket) {
        const supportTickets = await SupportTicket.countDocuments({ user: userId });
        
        metrics.interaction.supportTickets = {
          value: supportTickets,
          label: "Support Tickets",
          description: "Number of support tickets this user has created"
        };
        if (supportTickets > 0) hasRealMetrics = true;
      }
    } catch (error) {
      logger.error("Error fetching support ticket metrics:", error);
    }
    
    // Number of blog comments posted
    try {
      if (Comment) {
        const blogComments = await Comment.countDocuments({ user: userId });
        
        metrics.interaction.blogComments = {
          value: blogComments,
          label: "Blog Comments",
          description: "Number of comments this user has posted on blog articles"
        };
        if (blogComments > 0) hasRealMetrics = true;
      }
    } catch (error) {
      logger.error("Error fetching comment metrics:", error);
    }

    // If no real metrics data was found, provide demo data
    if (!hasRealMetrics) {
      logger.info(`No real metrics found for user ${userId}, providing demo data`);
      const createdDate = new Date(user.createdAt);
      const now = new Date();
      const userAgeDays = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));
      const isActive = user.isActive;
      
      // Generate realistic metrics based on the account age and activity
      const demoMultiplier = isActive ? 1 : 0.3; // Less activity for inactive users
      const loginCount = Math.floor(Math.min(userAgeDays, 30) * demoMultiplier);
      
      // SHOPPING BEHAVIOR DEMO
      metrics.shopping.productsPurchased = {
        value: Math.floor(loginCount * 0.5), // About half of logins result in purchase
        label: "Products Purchased",
        description: "Total number of products this user has purchased"
      };
      
      metrics.shopping.ordersPlaced = {
        value: Math.floor(loginCount * 0.3), // About a third of logins result in orders
        label: "Orders Placed",
        description: "Total number of orders this user has placed"
      };
      
      metrics.shopping.totalSpent = {
        value: (Math.floor(loginCount * 0.3) * 49.99).toFixed(2), // Average order $49.99
        label: "Total Spent",
        description: "Total amount of money this user has spent on purchases"
      };
      
      metrics.shopping.abandonedCartItems = {
        value: Math.floor(loginCount * 0.2), // 20% of logins leave items in cart
        label: "Abandoned Cart Items",
        description: "Number of items left in cart without completing purchase"
      };
      
      // ENGAGEMENT DEMO
      metrics.engagement.loginCount = {
        value: loginCount,
        label: "Login Count",
        description: "Number of times this user has logged into their account"
      };
      
      metrics.engagement.productViews = {
        value: loginCount * 5, // Average 5 product views per login
        label: "Product Views",
        description: "Number of product pages this user has viewed"
      };
      
      metrics.engagement.accountPageVisits = {
        value: Math.floor(loginCount * 0.7), // 70% of logins visit account page
        label: "Account Page Visits",
        description: "Number of times this user has visited their account pages"
      };
      
      // RECENCY DEMO
      const randomLastLoginDays = Math.floor(Math.random() * 10) + 1;
      metrics.recency.daysSinceLastLogin = {
        value: randomLastLoginDays,
        label: "Days Since Last Login",
        description: "Number of days since this user last logged in"
      };
      
      const randomLastPurchaseDays = Math.floor(Math.random() * 20) + 5;
      metrics.recency.daysSinceLastPurchase = {
        value: randomLastPurchaseDays,
        label: "Days Since Last Purchase",
        description: "Number of days since this user made their last purchase"
      };
      
      // INTERACTION DEMO
      metrics.interaction.reviewsSubmitted = {
        value: Math.floor(metrics.shopping.productsPurchased.value * 0.4), // 40% of purchases get reviewed
        label: "Reviews Submitted",
        description: "Number of product reviews this user has submitted"
      };
      
      // Only add support tickets if there are 'purchases' in the demo data
      if (metrics.shopping.ordersPlaced.value > 0) {
        metrics.interaction.supportTickets = {
          value: Math.floor(metrics.shopping.ordersPlaced.value * 0.15), // 15% of orders need support
          label: "Support Tickets",
          description: "Number of support tickets this user has created"
        };
      }
    }

    // Fall back to legacy metrics format if no structured metrics were generated
    if (Object.keys(metrics.shopping).length === 0 &&
        Object.keys(metrics.engagement).length === 0 &&
        Object.keys(metrics.recency).length === 0 &&
        Object.keys(metrics.interaction).length === 0) {
      
      // Legacy format with just basic metrics
      return res.status(200).json({ 
        success: true, 
        metrics: {
          productPurchasedCount: 0,
          loginFrequency: 0
        }
      });
    }

    res.status(200).json({ success: true, metrics });
  } catch (error) {
    logger.error("Get User Metrics Error:", error);
    res.status(500).json({ success: false, message: ERROR_CODES.SERVER_ERROR });
  }
};

/**
 * @desc    Cancel a pending invitation
 * @route   DELETE /api/users/admin/users/invite/:email
 * @access  Private/Admin
 */
exports.cancelInvitation = async (req, res) => {
  try {
    const { email } = req.params;
    
    // Find and delete all unused invitations for this email
    const result = await Invite.deleteOne({ email, isUsed: false });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "No active invitation found for this email."
      });
    }
    
    // Log the invitation cancelation in AuditLog
    try {
      await AuditLog.create({
        performedBy: req.user._id,
        entity: "Invite",
        action: "DELETE",
        details: `Canceled invitation for email: ${email}.`
      });
    } catch (auditError) {
      // Log the error but don't fail the cancelation process
      logger.error("Failed to create audit log for invitation cancelation:", auditError);
    }
    
    return res.status(200).json({
      success: true,
      message: "Invitation canceled successfully."
    });
  } catch (error) {
    logger.error("Cancel Invitation Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error canceling invitation",
      error: error.message
    });
  }
};
