const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');
const InfluencerUser = require('../models/InfluencerUser');
const InfluencerApplication = require('../models/InfluencerApplication');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/sendEmail');

// @desc    Login influencer user
// @route   POST /api/influencer/auth/login
// @access  Public
exports.login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  // Validate email
  if (!email) {
    return next(new ErrorResponse('Please provide an email', 400));
  }

  // Check for user
  const user = await InfluencerUser.findOne({ email }).select('+password');

  if (!user) {
    return next(new ErrorResponse('Invalid credentials', 401));
  }

  // Ensure the role is set
  if (!user.role) {
    user.role = 'influencer';
    await user.save();
  }

  // Check if password is set (for first time login)
  if (!user.password) {
    logger.info(`First time login for user: ${user.email}`);
    // First time login, don't require password
    return res.status(200).json({
      success: true,
      firstLogin: true,
      message: 'First time login detected. Please complete account setup.',
      setupRequired: true,
      token: user.getSignedJwtToken(),
      setupCompleted: user.setupCompleted,
      setupSteps: user.setupSteps
    });
  }

  // For empty password on regular login, provide appropriate error
  if (!password) {
    logger.warn(`Login attempt with empty password for user: ${user.email}`);
    return next(new ErrorResponse('Please enter your password', 401));
  }
  
  // Check if password matches
  const isMatch = await user.matchPassword(password);

  if (!isMatch) {
    logger.warn(`Invalid password attempt for user: ${user.email}`);
    return next(new ErrorResponse('Invalid credentials', 401));
  }

  // Update last login
  user.lastLogin = Date.now();
  await user.save();

  logger.info(`Successful login for user: ${user.email}`);
  sendTokenResponse(user, 200, res);
});

// @desc    Setup password for influencer account
// @route   PUT /api/influencer/auth/setup-password
// @access  Private/Influencer
exports.setupPassword = asyncHandler(async (req, res, next) => {
  const { password } = req.body;

  if (!password || password.length < 8) {
    return next(new ErrorResponse('Please provide a valid password (min 8 characters)', 400));
  }

  const user = await InfluencerUser.findById(req.user.id);

  user.password = password;
  user.setupSteps.password = true;
  await user.save();

  res.status(200).json({
    success: true,
    message: 'Password set successfully',
    setupSteps: user.setupSteps
  });
});

// @desc    Update social profiles
// @route   PUT /api/influencer/profile/socials
// @access  Private/Influencer
exports.updateSocialProfiles = asyncHandler(async (req, res, next) => {
  const { socials } = req.body;

  if (!socials || !Array.isArray(socials) || socials.length === 0) {
    return next(new ErrorResponse('Please provide at least one social profile', 400));
  }

  try {
    const user = await InfluencerUser.findById(req.user.id);

    // Process socials to ensure they have the right format
    // This ensures any custom ID from frontend won't conflict with MongoDB's _id
    const processedSocials = socials.map(social => ({
      platform: social.platform,
      platformName: social.platformName,
      url: social.url,
      id: social.id ? String(social.id) : undefined
    }));

    user.socials = processedSocials;
    user.setupSteps.socials = true;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Social profiles updated successfully',
      setupSteps: user.setupSteps
    });
  } catch (err) {
    console.error('Error updating social profiles:', err);
    return next(
      new ErrorResponse(
        'Error updating social profiles. Please check your data and try again.',
        400
      )
    );
  }
});

// @desc    Update payment details
// @route   PUT /api/influencer/profile/payment
// @access  Private/Influencer
exports.updatePaymentDetails = asyncHandler(async (req, res, next) => {
  const { paymentMethod, bankDetails, upiDetails } = req.body;

  // Add detailed debugging
  console.log('Payment update request received:');
  console.log('Payment Method:', paymentMethod);
  console.log('Bank Details:', JSON.stringify(bankDetails, null, 2));
  console.log('UPI Details:', JSON.stringify(upiDetails, null, 2));
  console.log('User ID:', req.user.id);

  if (!paymentMethod) {
    console.log('Error: No payment method provided');
    return next(new ErrorResponse('Please provide a payment method', 400));
  }

  try {
    // Find user and clear all payment data before updating
    const user = await InfluencerUser.findById(req.user.id);
    console.log('User found:', user.email);
    console.log('Current payment method:', user.paymentMethod);

    // Set payment method
    user.paymentMethod = paymentMethod;
    
    // Handle bank details
    if (paymentMethod === 'bank') {
      console.log('Setting bank details');
      
      // Verify required bank fields
      if (!bankDetails || !bankDetails.accountName || !bankDetails.accountNumber || 
          !bankDetails.ifscCode || !bankDetails.bankName) {
        console.log('Missing required bank details');
        return next(new ErrorResponse('All bank details are required', 400));
      }
      
      // Set bank details as a new object
      user.bankDetails = {
        accountName: bankDetails.accountName,
        accountNumber: bankDetails.accountNumber,
        ifscCode: bankDetails.ifscCode,
        bankName: bankDetails.bankName,
        branch: bankDetails.branch || '' // Optional field
      };
      
      // Clear UPI details
      user.upiDetails = undefined;
    } 
    // Handle UPI details
    else if (paymentMethod === 'upi') {
      console.log('Setting UPI details');
      
      // Verify required UPI fields
      if (!upiDetails || !upiDetails.upiId) {
        console.log('Missing required UPI details');
        return next(new ErrorResponse('UPI ID is required', 400));
      }
      
      // Set UPI details as a new object
      user.upiDetails = {
        upiId: upiDetails.upiId
      };
      
      // Clear bank details
      user.bankDetails = undefined;
    }

    // Mark payment step as complete
    user.setupSteps.payment = true;
    
    console.log('Saving user with payment method:', user.paymentMethod);
    console.log('Final bank details:', JSON.stringify(user.bankDetails, null, 2));
    console.log('Final UPI details:', JSON.stringify(user.upiDetails, null, 2));
    
    // Save the updated user
    await user.save();
    console.log('User saved successfully');

    res.status(200).json({
      success: true,
      message: 'Payment details updated successfully',
      setupSteps: user.setupSteps
    });
  } catch (error) {
    console.error('Error saving payment details:', error);
    return next(new ErrorResponse(`Error saving payment details: ${error.message}`, 500));
  }
});

// @desc    Skip payment setup
// @route   PUT /api/influencer/profile/skip-payment
// @access  Private/Influencer
exports.skipPaymentSetup = asyncHandler(async (req, res, next) => {
  const user = await InfluencerUser.findById(req.user.id);

  user.setupSteps.payment = true;
  await user.save();

  res.status(200).json({
    success: true,
    message: 'Payment setup skipped',
    setupSteps: user.setupSteps
  });
});

// @desc    Send mobile verification OTP
// @route   POST /api/influencer/profile/send-otp
// @access  Private/Influencer
exports.sendMobileVerificationOTP = asyncHandler(async (req, res, next) => {
  const { mobileNumber } = req.body;

  console.log('OTP Send Request:');
  console.log('User ID:', req.user?.id);
  console.log('Mobile Number:', mobileNumber);

  if (!mobileNumber || !/^[6-9]\d{9}$/.test(mobileNumber)) {
    console.log('ERROR: Invalid mobile number format');
    return next(new ErrorResponse('Please provide a valid 10-digit mobile number', 400));
  }

  try {
    // Generate a 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    console.log('Generated OTP:', otp);
    
    // Store OTP in user document with pending mobile number
    const user = await InfluencerUser.findById(req.user.id);
    if (!user) {
      console.log('ERROR: User not found');
      return next(new ErrorResponse('User not found', 404));
    }
    
    // Store directly to mobileNumber (no waiting for verification)
    user.mobileNumber = mobileNumber;
    user.mobileVerified = true; // Auto-verify for now
    user.setupSteps.verification = true; // Mark step as complete
    
    // Keep OTP info for reference, though we're auto-verifying
    user.pendingMobileNumber = mobileNumber;
    user.verificationOTP = otp;
    user.verificationOTPExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    
    console.log(`Storing mobile number: ${mobileNumber}`);
    console.log(`User before save:`, { 
      email: user.email, 
      mobileNumber: user.mobileNumber,
      mobileVerified: user.mobileVerified,
      setupSteps: user.setupSteps
    });
    
    await user.save();
    console.log('User saved successfully with mobile number');

    // In production, send actual SMS
    // For demo, log OTP
    logger.info(`OTP for ${mobileNumber}: ${otp}`);

    res.status(200).json({
      success: true,
      message: 'Mobile number saved successfully',
      verified: true, // Tell frontend it's auto-verified
      setupComplete: true,
      // Include the OTP in response for demo purposes only
      // Remove in production
      otp: otp
    });
  } catch (error) {
    console.error('Error in sendMobileVerificationOTP:', error);
    return next(new ErrorResponse(`Error sending OTP: ${error.message}`, 500));
  }
});

// @desc    Verify mobile OTP
// @route   POST /api/influencer/profile/verify-otp
// @access  Private/Influencer
exports.verifyMobileOTP = asyncHandler(async (req, res, next) => {
  const { otp } = req.body;

  if (!otp) {
    return next(new ErrorResponse('Please provide the OTP', 400));
  }

  const user = await InfluencerUser.findById(req.user.id);

  // Add detailed debugging
  console.log('OTP Verification Attempt:');
  console.log('User ID:', req.user.id);
  console.log('User Email:', user.email);
  console.log('Received OTP:', otp);
  console.log('Stored OTP:', user.verificationOTP);
  console.log('Pending Mobile Number:', user.pendingMobileNumber);
  console.log('Mobile Number:', user.mobileNumber);
  console.log('Mobile Verified:', user.mobileVerified);

  // If already verified, just return success
  if (user.mobileVerified && user.mobileNumber) {
    console.log('Mobile already verified, returning success');
    return res.status(200).json({
      success: true,
      message: 'Mobile number already verified',
      setupSteps: user.setupSteps
    });
  }

  // Check if there's a pending mobile number
  if (!user.pendingMobileNumber) {
    console.log('ERROR: No pending mobile number found');
    return next(new ErrorResponse('No mobile verification in progress', 400));
  }

  // In a real app, verify OTP expiry time and match
  // For demo, we'll just verify the OTP
  // Ensure OTPs are compared as strings
  if (String(user.verificationOTP) !== String(otp)) {
    console.log('ERROR: OTP mismatch');
    console.log(`Expected: "${user.verificationOTP}" (${typeof user.verificationOTP})`);
    console.log(`Received: "${otp}" (${typeof otp})`);
    return next(new ErrorResponse('Invalid OTP', 400));
  }

  // Mark as verified and transfer from pending to actual mobile number
  console.log(`Mobile verified successfully: ${user.pendingMobileNumber}`);
  user.mobileNumber = user.pendingMobileNumber;
  user.pendingMobileNumber = undefined; // Clear the pending field
  user.mobileVerified = true;
  user.verificationOTP = undefined;
  user.verificationOTPExpires = undefined;
  user.setupSteps.verification = true;
  
  try {
    await user.save();
    console.log('User saved successfully after OTP verification');
  } catch (err) {
    console.error('Error saving user after OTP verification:', err);
    return next(new ErrorResponse(`Error saving verification: ${err.message}`, 500));
  }

  res.status(200).json({
    success: true,
    message: 'Mobile number verified successfully',
    setupSteps: user.setupSteps
  });
});

// @desc    Complete account setup
// @route   PUT /api/influencer/profile/complete-setup
// @access  Private/Influencer
exports.completeSetup = asyncHandler(async (req, res, next) => {
  try {
    const user = await InfluencerUser.findById(req.user.id);
    
    logger.info(`Setup completion requested for user: ${user.email}`);
    logger.info(`Current setup steps: ${JSON.stringify(user.setupSteps)}`);
    
    // Check required steps - at minimum require password setup
    const requiredStepsComplete = user.setupSteps.password;
    
    if (!requiredStepsComplete) {
      logger.warn(`Attempting to complete setup without setting password: ${user.email}`);
      return next(new ErrorResponse('Password setup is required to complete setup', 400));
    }
    
    // If socials or verification aren't completed, auto-complete them
    // This is a fallback to ensure users can complete setup even if some steps fail
    if (!user.setupSteps.socials) {
      logger.info(`Auto-completing socials setup for user: ${user.email}`);
      user.setupSteps.socials = true;
    }
    
    if (!user.setupSteps.verification) {
      logger.info(`Auto-completing verification setup for user: ${user.email}`);
      user.setupSteps.verification = true;
      user.mobileVerified = true;
    }
    
    if (!user.setupSteps.payment) {
      logger.info(`Auto-completing payment setup for user: ${user.email}`);
      user.setupSteps.payment = true;
    }
    
    // Mark setup as completed
    user.setupCompleted = true;
    await user.save();
    
    logger.info(`Setup completed successfully for user: ${user.email}`);

    // Send welcome email
    try {
      await sendEmail({
        email: user.email,
        subject: 'Welcome to 10X Influencer Platform!',
        message: `
          <h1>Welcome to 10X Influencers!</h1>
          <p>Dear ${user.name},</p>
          <p>Your account setup is now complete. You're ready to start using the 10X Influencer platform.</p>
          <p>Login at: <a href="${process.env.INFLUENCER_URL || 'http://localhost:8080'}/login">${process.env.INFLUENCER_URL || 'http://localhost:8080'}/login</a></p>
          <p>Thank you for joining us!</p>
        `
      });
      logger.info(`Welcome email sent to: ${user.email}`);
    } catch (err) {
      logger.error(`Error sending welcome email: ${err.message}`);
    }

    res.status(200).json({
      success: true,
      message: 'Account setup completed successfully',
      setupCompleted: true
    });
  } catch (error) {
    logger.error(`Error in complete setup: ${error.message}`);
    return next(new ErrorResponse('An error occurred during setup completion', 500));
  }
});

// @desc    Get current influencer profile
// @route   GET /api/influencer/profile
// @access  Private/Influencer
exports.getProfile = asyncHandler(async (req, res, next) => {
  const user = await InfluencerUser.findById(req.user.id);

  res.status(200).json({
    success: true,
    data: user
  });
});

// @desc    Clear mobile number
// @route   DELETE /api/influencer/profile/mobile
// @access  Private/Influencer
exports.clearMobileNumber = asyncHandler(async (req, res, next) => {
  try {
    const user = await InfluencerUser.findById(req.user.id);
    
    logger.info(`Clearing mobile number for user: ${user.email}`);
    
    // Clear both mobile fields and verification status
    user.mobileNumber = undefined;
    user.pendingMobileNumber = undefined;
    user.mobileVerified = false;
    user.verificationOTP = undefined;
    user.verificationOTPExpires = undefined;
    
    // Don't reset the setup step as it may have been completed
    // during account creation flow
    
    await user.save();
    logger.info(`Mobile number cleared for user: ${user.email}`);
    
    res.status(200).json({
      success: true,
      message: 'Mobile number cleared successfully'
    });
  } catch (error) {
    logger.error(`Error clearing mobile number: ${error.message}`);
    return next(new ErrorResponse('Error clearing mobile number', 500));
  }
});

// @desc    Force verify mobile number for testing
// @route   PUT /api/influencer/profile/test-verify-mobile
// @access  Private/Influencer
exports.testVerifyMobile = asyncHandler(async (req, res, next) => {
  try {
    const { mobileNumber } = req.body;
    
    if (!mobileNumber || !/^[6-9]\d{9}$/.test(mobileNumber)) {
      return next(new ErrorResponse('Please provide a valid 10-digit mobile number', 400));
    }
    
    logger.info(`Test mobile verification requested for user: ${req.user.id}`);
    logger.info(`Mobile number: ${mobileNumber}`);
    
    const user = await InfluencerUser.findById(req.user.id);
    
    // Set the mobile number directly (bypass pending verification)
    user.mobileNumber = mobileNumber;
    user.mobileVerified = true;
    user.setupSteps.verification = true;
    
    // Clear any pending verification
    user.pendingMobileNumber = undefined;
    user.verificationOTP = undefined;
    user.verificationOTPExpires = undefined;
    
    await user.save();
    logger.info(`Test mobile verification completed successfully for: ${mobileNumber}`);
    
    res.status(200).json({
      success: true,
      message: 'Mobile number verified successfully (TEST MODE)',
      setupSteps: user.setupSteps
    });
  } catch (error) {
    logger.error(`Error in test verify: ${error.message}`);
    return next(new ErrorResponse('Error in test verification', 500));
  }
});

// Helper function to get token from model, create cookie and send response
const sendTokenResponse = (user, statusCode, res) => {
  try {
    // Create token
    const token = user.getSignedJwtToken();

    // Convert JWT_COOKIE_EXPIRE to integer
    const expiresIn = parseInt(process.env.JWT_COOKIE_EXPIRE || '30') * 24 * 60 * 60 * 1000;
    
    const options = {
      expires: new Date(Date.now() + expiresIn),
      httpOnly: true
    };

    if (process.env.NODE_ENV === 'production') {
      options.secure = true;
    }

    // For debugging
    logger.info(`Generated token for user: ${user.email}`);

    // Send the response, but don't fail if cookie can't be set
    return res
      .status(statusCode)
      .cookie('token', token, options)
      .json({
        success: true,
        token,
        role: 'influencer',
        setupCompleted: user.setupCompleted,
        setupSteps: user.setupSteps
      });
  } catch (error) {
    logger.error(`Error in sendTokenResponse: ${error.message}`);
    
    // Fall back to just sending the token without cookie
    return res.status(statusCode).json({
      success: true,
      token: user.getSignedJwtToken(),
      role: 'influencer',
      setupCompleted: user.setupCompleted,
      setupSteps: user.setupSteps
    });
  }
}; 