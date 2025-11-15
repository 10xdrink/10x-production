// controllers/reviewController.js

const asyncHandler = require('express-async-handler');
const Review = require('../models/Review');
const Product = require('../models/Product');
const logger = require('../utils/logger');
const MESSAGES = require('../messages/en');
const ERROR_CODES = require('../constants/errorCodes');
const { uploadImage, deleteImage, extractKeyFromUrl } = require('../services/s3Service');
const { compressReviewPhoto } = require('../utils/imageCompressor');

/**
 * @desc    Create a new review
 * @route   POST /api/reviews
 * @access  Private/User
 */
exports.createReview = asyncHandler(async (req, res, next) => {
  const { product, rating, comment } = req.body;

  // Check if product exists and is active
  const existingProduct = await Product.findById(product);
  if (!existingProduct || !existingProduct.isActive) {
    res.status(400);
    throw new Error('Invalid or inactive product.');
  }

  // Check if user has already reviewed this product
  const existingReview = await Review.findOne({ product, user: req.user._id });
  if (existingReview) {
    res.status(400);
    throw new Error('You have already reviewed this product.');
  }

  // Initialize reviewData
  const reviewData = {
    product,
    user: req.user._id,
    rating,
    comment,
  };

  // Handle photo uploads if provided
  if (req.files && req.files.length > 0) {
    const uploadedPhotos = [];

    for (const file of req.files) {
      try {
        // Compress image before uploading
        const compressedBuffer = await compressReviewPhoto(file.buffer);
        
        const uploadResult = await uploadImage(compressedBuffer, {
          folder: 'review_photos',
          originalName: file.originalname,
          mimeType: 'image/jpeg',
        });

        uploadedPhotos.push({
          url: uploadResult.secure_url,
          public_id: uploadResult.key, // Use S3 key as public_id for consistency
        });
      } catch (uploadError) {
        logger.error('Photo Upload Failed:', uploadError);
        res.status(500);
        throw new Error('Failed to upload photos.');
      }
    }

    reviewData.photos = uploadedPhotos;
  }

  // Create review
  const review = await Review.create(reviewData);

  res.status(201).json({
    success: true,
    data: review,
    message: MESSAGES.REVIEW.CREATE_SUCCESS,
  });
});

/**
 * @desc    Get all reviews with optional filters
 * @route   GET /api/reviews
 * @access  Private/Admin/Product Manager
 */
exports.getAllReviews = asyncHandler(async (req, res, next) => {
  const { product, isApproved, page = 1, limit = 10 } = req.query;
  let filter = {};

  if (product) {
    filter.product = product;
  }

  if (isApproved !== undefined) {
    filter.isApproved = isApproved === 'true';
  }

  const skip = (page - 1) * limit;

  const reviews = await Review.find(filter)
    .populate('product', 'title')
    .populate('user', 'name email')
    .sort({ createdAt: -1 })
    .skip(parseInt(skip))
    .limit(parseInt(limit));

  const total = await Review.countDocuments(filter);

  res.status(200).json({
    success: true,
    count: reviews.length,
    total,
    data: reviews,
    message: MESSAGES.REVIEW.FETCH_SUCCESS,
  });
});

/**
 * @desc    Get a single review by ID
 * @route   GET /api/reviews/:id
 * @access  Private/Admin/Product Manager
 */
exports.getReviewById = asyncHandler(async (req, res, next) => {
  const review = await Review.findById(req.params.id)
    .populate('product', 'title')
    .populate('user', 'name email');

  if (!review) {
    res.status(404);
    throw new Error(MESSAGES.REVIEW.REVIEW_NOT_FOUND);
  }

  res.status(200).json({
    success: true,
    data: review,
    message: MESSAGES.REVIEW.FETCH_SUCCESS,
  });
});

/**
 * @desc    Update a review (e.g., approve/reject)
 * @route   PUT /api/reviews/:id
 * @access  Private/Admin/Product Manager
 */
exports.updateReview = asyncHandler(async (req, res, next) => {
  const { isApproved, comment } = req.body;

  const review = await Review.findById(req.params.id);

  if (!review) {
    res.status(404);
    throw new Error(MESSAGES.REVIEW.REVIEW_NOT_FOUND);
  }

  if (isApproved !== undefined) {
    review.isApproved = isApproved;
  }

  if (comment) {
    review.comment = comment;
  }

  await review.save();

  res.status(200).json({
    success: true,
    data: review,
    message: MESSAGES.REVIEW.UPDATE_SUCCESS,
  });
});

/**
 * @desc    Delete a review
 * @route   DELETE /api/reviews/:id
 * @access  Private/Admin/Product Manager
 */
exports.deleteReview = asyncHandler(async (req, res, next) => {
  const review = await Review.findById(req.params.id);

  if (!review) {
    res.status(404);
    throw new Error(MESSAGES.REVIEW.REVIEW_NOT_FOUND);
  }

  // Optionally, delete associated photos from S3
  if (review.photos && review.photos.length > 0) {
    for (const photo of review.photos) {
      try {
        // photo.public_id now contains the S3 key
        await deleteImage(photo.public_id);
      } catch (err) {
        logger.error(`Failed to delete photo ${photo.public_id} from S3:`, err);
      }
    }
  }

  await review.remove();

  res.status(200).json({
    success: true,
    message: MESSAGES.REVIEW.DELETE_SUCCESS,
  });
});
