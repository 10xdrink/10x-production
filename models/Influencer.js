const mongoose = require('mongoose');

const InfluencerSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Please provide full name'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Please provide an email'],
      unique: true,
      lowercase: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        'Please provide a valid email',
      ],
    },
    whatsapp: {
      type: String,
      trim: true,
    },
    contactPreference: {
      type: String,
      enum: ['email', 'whatsapp'],
      default: 'email',
    },
    platforms: {
      type: [String],
      enum: ['instagram', 'youtube', 'tiktok', 'blog', 'podcast'],
      default: [],
    },
    followers: {
      type: String,
      enum: ['1k-5k', '5k-10k', '10k-50k', '50k-100k', '100k-500k', '500k+'],
    },
    niche: {
      type: String,
      trim: true,
    },
    // Platform details
    instagram: {
      type: String,
      trim: true,
    },
    youtube: {
      type: String,
      trim: true,
    },
    tiktok: {
      type: String,
      trim: true,
    },
    website: {
      type: String,
      trim: true,
    },
    podcast: {
      type: String,
      trim: true,
    },
    // Additional information
    experience: {
      type: String,
      trim: true,
    },
    goals: {
      type: String,
      trim: true,
    },
    why: {
      type: String,
      trim: true,
    },
    availability: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
    // Partner account details
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InfluencerUser',
    },
    applicationDate: {
      type: Date,
      default: Date.now,
    },
    reviewDate: {
      type: Date,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    credentials: {
      password: {
        type: String,
      },
      filePath: {
        type: String,
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Influencer', InfluencerSchema); 