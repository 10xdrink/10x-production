const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const influencerUserController = require('../controllers/influencerUserController');
const { protect, authorize } = require('../middleware/auth');
const validateMiddleware = require('../middleware/validateMiddleware');

// Validation rules
const passwordValidation = [
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number')
    .matches(/[^A-Za-z0-9]/)
    .withMessage('Password must contain at least one special character')
];

const socialsValidation = [
  body('socials')
    .isArray({ min: 1 })
    .withMessage('At least one social profile is required'),
  body('socials.*.platform')
    .isIn(['instagram', 'youtube', 'tiktok', 'blog', 'podcast'])
    .withMessage('Invalid platform'),
  body('socials.*.platformName')
    .notEmpty()
    .withMessage('Platform name is required'),
  body('socials.*.url')
    .notEmpty()
    .withMessage('URL or username is required')
];

const paymentValidation = [
  body('paymentMethod')
    .isIn(['bank', 'upi'])
    .withMessage('Invalid payment method'),
  body('bankDetails')
    .if(body('paymentMethod').equals('bank'))
    .isObject()
    .withMessage('Bank details are required for bank payment method'),
  body('bankDetails.accountName')
    .if(body('paymentMethod').equals('bank'))
    .notEmpty()
    .withMessage('Account name is required'),
  body('bankDetails.accountNumber')
    .if(body('paymentMethod').equals('bank'))
    .notEmpty()
    .withMessage('Account number is required'),
  body('bankDetails.ifscCode')
    .if(body('paymentMethod').equals('bank'))
    .notEmpty()
    .withMessage('IFSC code is required'),
  body('bankDetails.bankName')
    .if(body('paymentMethod').equals('bank'))
    .notEmpty()
    .withMessage('Bank name is required'),
  body('upiDetails')
    .if(body('paymentMethod').equals('upi'))
    .isObject()
    .withMessage('UPI details are required for UPI payment method'),
  body('upiDetails.upiId')
    .if(body('paymentMethod').equals('upi'))
    .notEmpty()
    .withMessage('UPI ID is required')
    .matches(/^.+@.+$/)
    .withMessage('Invalid UPI ID format')
];

const mobileValidation = [
  body('mobileNumber')
    .matches(/^[6-9]\d{9}$/)
    .withMessage('Invalid mobile number. Must be a 10-digit number starting with 6-9')
];

const otpValidation = [
  body('otp')
    .isLength({ min: 4, max: 4 })
    .withMessage('OTP must be exactly 4 digits')
    .isNumeric()
    .withMessage('OTP must contain only numbers')
];

// Authentication routes
router.post('/auth/login', influencerUserController.login);

// Account setup routes - protected for influencers only
router.put(
  '/auth/setup-password', 
  protect, 
  authorize('influencer'), 
  passwordValidation,
  validateMiddleware,
  influencerUserController.setupPassword
);

router.put(
  '/profile/socials', 
  protect, 
  authorize('influencer'), 
  socialsValidation,
  validateMiddleware,
  influencerUserController.updateSocialProfiles
);

router.put(
  '/profile/payment', 
  protect, 
  authorize('influencer'), 
  paymentValidation, 
  validateMiddleware,
  influencerUserController.updatePaymentDetails
);

router.put(
  '/profile/skip-payment',
  protect,
  authorize('influencer'),
  influencerUserController.skipPaymentSetup
);

router.post(
  '/profile/send-otp',
  protect,
  authorize('influencer'),
  mobileValidation,
  validateMiddleware,
  influencerUserController.sendMobileVerificationOTP
);

// Still available but now optional since mobile verification is auto-completed
router.post(
  '/profile/verify-otp',
  protect,
  authorize('influencer'),
  otpValidation,
  validateMiddleware,
  influencerUserController.verifyMobileOTP
);

router.put(
  '/profile/complete-setup',
  protect,
  authorize('influencer'),
  influencerUserController.completeSetup
);

router.get(
  '/profile',
  protect,
  authorize('influencer'),
  influencerUserController.getProfile
);

router.delete(
  '/profile/mobile',
  protect,
  authorize('influencer'),
  influencerUserController.clearMobileNumber
);

// Test routes for debugging
router.put(
  '/profile/test-payment',
  protect,
  authorize('influencer'),
  influencerUserController.updatePaymentDetails // Reuse the same controller but bypass validation
);

router.put(
  '/profile/test-verify-mobile',
  protect,
  authorize('influencer'),
  mobileValidation,
  validateMiddleware,
  influencerUserController.testVerifyMobile
);

module.exports = router; 