// routes/influencerRoutes.js

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const influencerController = require('../controllers/influencerController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const validateMiddleware = require('../middleware/validateMiddleware');
const USER_ROLES = require('../constants/userRoles');

// Validation rules for new application
const applicationValidation = [
  body('fullName')
    .notEmpty()
    .withMessage('Full name is required')
    .isLength({ min: 3 })
    .withMessage('Name must be at least 3 characters long'),
  
  body('email')
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Please provide a valid email'),
  
  body('platforms')
    .isArray({ min: 1 })
    .withMessage('Please select at least one platform'),
  
  body('followers')
    .notEmpty()
    .withMessage('Please select your follower count range'),
  
  body('niche')
    .notEmpty()
    .withMessage('Content niche is required'),
  
  body('experience')
    .notEmpty()
    .withMessage('Experience information is required'),
  
  body('goals')
    .notEmpty()
    .withMessage('Partnership goals are required'),
  
  body('why')
    .notEmpty()
    .withMessage('Please explain why you want to join 10X')
];

// Review validation
const reviewValidation = [
  body('status')
    .isIn(['approved', 'rejected'])
    .withMessage('Status must be either approved or rejected'),
  
  body('rejectionReason')
    .if(body('status').equals('rejected'))
    .notEmpty()
    .withMessage('Rejection reason is required when rejecting an application')
];

// Public routes
router.post(
  '/apply',
  applicationValidation,
  validateMiddleware,
  influencerController.submitApplication
);

// Admin routes
router.get(
  '/',
  authMiddleware,
  adminMiddleware([
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.MARKETING_MANAGER,
    USER_ROLES.CONTENT_MANAGER
  ]),
  influencerController.getApplications
);

router.get(
  '/stats',
  authMiddleware,
  adminMiddleware([
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.MARKETING_MANAGER,
    USER_ROLES.CONTENT_MANAGER
  ]),
  influencerController.getInfluencerStats
);

router.get(
  '/partners',
  authMiddleware,
  adminMiddleware([
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.MARKETING_MANAGER,
    USER_ROLES.CONTENT_MANAGER
  ]),
  influencerController.getPartners
);

router.get(
  '/:id',
  authMiddleware,
  adminMiddleware([
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.MARKETING_MANAGER,
    USER_ROLES.CONTENT_MANAGER
  ]),
  influencerController.getApplication
);

router.put(
  '/:id/review',
  authMiddleware,
  adminMiddleware([
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.MARKETING_MANAGER
  ]),
  reviewValidation,
  validateMiddleware,
  influencerController.reviewApplication
);

router.post(
  '/:id/resend-credentials',
  authMiddleware,
  adminMiddleware([
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.MARKETING_MANAGER
  ]),
  influencerController.resendCredentials
);

router.delete(
  '/:id',
  authMiddleware,
  adminMiddleware([
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.MARKETING_MANAGER
  ]),
  influencerController.deleteApplication
);

// Route to delete influencer user account
router.delete(
  '/user/:id',
  authMiddleware,
  adminMiddleware([
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.MARKETING_MANAGER
  ]),
  influencerController.deleteInfluencerUser
);

module.exports = router; 