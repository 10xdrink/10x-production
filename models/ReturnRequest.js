const mongoose = require('mongoose');

const returnRequestSchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [{
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    reason: {
      type: String,
      required: true
    },
    condition: {
      type: String,
      enum: ['unopened', 'opened', 'damaged', 'defective'],
      required: true
    }
  }],
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'completed'],
    default: 'pending'
  },
  returnMethod: {
    type: String,
    enum: ['pickup', 'dropoff'],
    required: true
  },
  pickupAddress: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: String
  },
  returnTrackingNumber: String,
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: Date,
  completedAt: Date,
  refundId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Refund'
  },
  notes: {
    customerNotes: String,
    adminNotes: String
  }
}, {
  timestamps: true
});

// Add index for faster queries
returnRequestSchema.index({ orderId: 1, status: 1 });
returnRequestSchema.index({ customer: 1, createdAt: -1 });

module.exports = mongoose.model('ReturnRequest', returnRequestSchema); 