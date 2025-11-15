// controllers/emailListController.js

const EmailList = require('../models/EmailList');
const asyncHandler = require('express-async-handler');

/**
 * @desc    Add a new subscriber to the email list
 * @route   POST /api/email-list
 * @access  Public
 */
exports.addSubscriber = asyncHandler(async (req, res, next) => {
  const { name, email } = req.body;

  // Validate input
  if (!name || !email) {
    res.status(400);
    throw new Error('Please provide both name and email');
  }

  // Check if the email already exists
  const existingSubscriber = await EmailList.findOne({ email });

  if (existingSubscriber) {
    res.status(400);
    throw new Error('This email is already subscribed');
  }

  // Create a new subscriber
  const subscriber = await EmailList.create({ name, email });

  res.status(201).json({
    success: true,
    data: subscriber,
    message: 'Subscription successful',
  });
});

/**
 * @desc    Get all subscribers
 * @route   GET /api/email-list
 * @access  Private/Admin
 */
exports.getSubscribers = asyncHandler(async (req, res, next) => {
  // Pagination parameters
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const startIndex = (page - 1) * limit;
  
  // Search parameters
  const search = req.query.search || '';
  const searchQuery = search ? {
    $or: [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ]
  } : {};

  // Get total count for pagination
  const total = await EmailList.countDocuments(searchQuery);
  
  // Get subscribers with pagination and sorting
  const subscribers = await EmailList.find(searchQuery)
    .sort({ createdAt: -1 })
    .skip(startIndex)
    .limit(limit);

  res.status(200).json({
    success: true,
    count: subscribers.length,
    total,
    pagination: {
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
    data: subscribers,
  });
});

/**
 * @desc    Get a single subscriber
 * @route   GET /api/email-list/:id
 * @access  Private/Admin
 */
exports.getSubscriber = asyncHandler(async (req, res, next) => {
  const subscriber = await EmailList.findById(req.params.id);

  if (!subscriber) {
    res.status(404);
    throw new Error('Subscriber not found');
  }

  res.status(200).json({
    success: true,
    data: subscriber,
  });
});

/**
 * @desc    Update a subscriber
 * @route   PUT /api/email-list/:id
 * @access  Private/Admin
 */
exports.updateSubscriber = asyncHandler(async (req, res, next) => {
  const { name, email } = req.body;

  // Validate input
  if (!name || !email) {
    res.status(400);
    throw new Error('Please provide both name and email');
  }

  // Check if the email already exists (only if email is being changed)
  if (email) {
    const existingSubscriber = await EmailList.findOne({ 
      email, 
      _id: { $ne: req.params.id } 
    });

    if (existingSubscriber) {
      res.status(400);
      throw new Error('This email is already subscribed by another user');
    }
  }

  // Update the subscriber
  const subscriber = await EmailList.findByIdAndUpdate(
    req.params.id,
    { name, email },
    { new: true, runValidators: true }
  );

  if (!subscriber) {
    res.status(404);
    throw new Error('Subscriber not found');
  }

  res.status(200).json({
    success: true,
    data: subscriber,
    message: 'Subscriber updated successfully',
  });
});

/**
 * @desc    Delete a subscriber
 * @route   DELETE /api/email-list/:id
 * @access  Private/Admin
 */
exports.deleteSubscriber = asyncHandler(async (req, res, next) => {
  const subscriber = await EmailList.findByIdAndDelete(req.params.id);

  if (!subscriber) {
    res.status(404);
    throw new Error('Subscriber not found');
  }

  res.status(200).json({
    success: true,
    data: {},
    message: 'Subscriber deleted successfully',
  });
});

/**
 * @desc    Delete multiple subscribers
 * @route   DELETE /api/email-list/bulk
 * @access  Private/Admin
 */
exports.bulkDeleteSubscribers = asyncHandler(async (req, res, next) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    res.status(400);
    throw new Error('Please provide an array of subscriber IDs');
  }

  const result = await EmailList.deleteMany({ _id: { $in: ids } });

  res.status(200).json({
    success: true,
    data: { deletedCount: result.deletedCount },
    message: `${result.deletedCount} subscribers deleted successfully`,
  });
});

/**
 * @desc    Export all subscribers
 * @route   GET /api/email-list/export
 * @access  Private/Admin
 */
exports.exportSubscribers = asyncHandler(async (req, res, next) => {
  const subscribers = await EmailList.find().sort({ createdAt: -1 });
  
  // Format data for CSV export
  const formattedData = subscribers.map(sub => ({
    id: sub._id,
    name: sub.name,
    email: sub.email,
    subscribed_at: sub.createdAt.toISOString().split('T')[0],
  }));

  res.status(200).json({
    success: true,
    count: subscribers.length,
    data: formattedData,
  });
});
