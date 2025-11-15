const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const socialProfileSchema = new mongoose.Schema({
  platform: {
    type: String,
    required: true,
    enum: ['instagram', 'youtube', 'tiktok', 'blog', 'podcast']
  },
  platformName: {
    type: String,
    required: true
  },
  url: {
    type: String,
    required: true
  },
  id: {
    type: String,
    required: false
  }
}, { 
  _id: true,
  id: false,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Delete _id from incoming data if id is provided
socialProfileSchema.pre('validate', function(next) {
  if (this.id) {
    this._id = undefined; // Skip validation for _id if id is provided
  }
  next();
});

const bankDetailsSchema = new mongoose.Schema({
  accountName: {
    type: String,
    required: function() { return this.paymentMethod === 'bank' }
  },
  accountNumber: {
    type: String,
    required: function() { return this.paymentMethod === 'bank' }
  },
  ifscCode: {
    type: String,
    required: function() { return this.paymentMethod === 'bank' }
  },
  bankName: {
    type: String,
    required: function() { return this.paymentMethod === 'bank' }
  },
  branch: {
    type: String
  }
}, { _id: false });

const upiDetailsSchema = new mongoose.Schema({
  upiId: {
    type: String,
    required: function() { return this.paymentMethod === 'upi' }
  }
}, { _id: false });

const influencerUserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    match: [
      /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
      'Please provide a valid email'
    ]
  },
  password: {
    type: String,
    minlength: 8,
    select: false
  },
  name: {
    type: String,
    required: [true, 'Please provide a name']
  },
  role: {
    type: String,
    default: 'influencer',
    enum: ['influencer'],
  },
  applicationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Influencer',
    required: true
  },
  setupCompleted: {
    type: Boolean,
    default: false
  },
  setupSteps: {
    password: {
      type: Boolean,
      default: false
    },
    socials: {
      type: Boolean,
      default: false
    },
    payment: {
      type: Boolean,
      default: false
    },
    verification: {
      type: Boolean,
      default: false
    }
  },
  socials: [socialProfileSchema],
  paymentMethod: {
    type: String,
    enum: ['bank', 'upi', null],
    default: null
  },
  bankDetails: bankDetailsSchema,
  upiDetails: upiDetailsSchema,
  mobileNumber: {
    type: String,
    match: [/^[6-9]\d{9}$/, 'Please provide a valid 10-digit mobile number']
  },
  pendingMobileNumber: {
    type: String,
    match: [/^[6-9]\d{9}$/, 'Please provide a valid 10-digit mobile number']
  },
  mobileVerified: {
    type: Boolean,
    default: false
  },
  notificationPreferences: {
    sales: {
      type: Boolean,
      default: true
    },
    campaigns: {
      type: Boolean,
      default: true
    },
    payments: {
      type: Boolean,
      default: true
    }
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended'],
    default: 'active'
  },
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  lastLogin: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Encrypt password using bcrypt
influencerUserSchema.pre('save', async function (next) {
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }
  
  if (this.isModified('paymentMethod')) {
    console.log(`Pre-save: Payment method changed to ${this.paymentMethod}`);
    
    if (this.paymentMethod === 'bank' && (!this.bankDetails || Object.keys(this.bankDetails).length === 0)) {
      console.log('Pre-save: Bank selected but no bank details - setting validation error');
      const err = new Error('Bank details are required when payment method is set to bank');
      return next(err);
    }
    
    if (this.paymentMethod === 'upi' && (!this.upiDetails || Object.keys(this.upiDetails).length === 0)) {
      console.log('Pre-save: UPI selected but no UPI details - setting validation error');
      const err = new Error('UPI details are required when payment method is set to UPI');
      return next(err);
    }
    
    if (this.paymentMethod === 'bank') {
      this.upiDetails = undefined;
      console.log('Pre-save: Cleared UPI details');
    } else if (this.paymentMethod === 'upi') {
      this.bankDetails = undefined;
      console.log('Pre-save: Cleared bank details');
    }
  }
  
  next();
});

// Sign JWT and return
influencerUserSchema.methods.getSignedJwtToken = function () {
  return jwt.sign({ id: this._id, role: 'influencer' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE
  });
};

// Match user entered password to hashed password in database
influencerUserSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('InfluencerUser', influencerUserSchema); 