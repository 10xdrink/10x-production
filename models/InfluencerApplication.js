const mongoose = require('mongoose');

const InfluencerApplicationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a name'],
    trim: true,
    maxlength: [50, 'Name cannot be more than 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please add a valid email'
    ]
  },
  phone: {
    type: String,
    required: [true, 'Please add a phone number'],
    maxlength: [20, 'Phone number cannot be more than 20 characters']
  },
  platforms: {
    type: [String],
    required: [true, 'Please select at least one platform'],
    enum: ['instagram', 'youtube', 'tiktok', 'blog', 'podcast']
  },
  followerCount: {
    type: String,
    required: [true, 'Please select your follower count range']
  },
  niche: {
    type: String,
    required: [true, 'Please add your content niche']
  },
  experience: {
    type: String,
    required: [true, 'Please provide your experience details']
  },
  links: {
    type: [String],
    required: [true, 'Please add at least one link to your content']
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  rejectionReason: {
    type: String
  },
  reviewDate: {
    type: Date
  },
  reviewedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  },
  userId: {
    type: mongoose.Schema.ObjectId,
    ref: 'InfluencerUser'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('InfluencerApplication', InfluencerApplicationSchema); 