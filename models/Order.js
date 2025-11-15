// models/Order.js

const mongoose = require('mongoose');
const ORDER_STATUS = require('../constants/orderStatus'); // Order status constants
const AddressSchema = require('./Address'); // Import the AddressSchema

// Order Item Schema
const OrderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Please add a product'],
    },
    variant: {
      type: String,
      required: [true, 'Please add a variant'],
    },
    packaging: {
      type: String,
      required: [true, 'Please add a packaging'],
    },
    quantity: {
      type: Number,
      required: [true, 'Please add quantity'],
      min: [1, 'Quantity cannot be less than 1'],
    },
    price: {
      type: Number,
      required: [true, 'Please add price'],
      min: [0, 'Price cannot be negative'],
    },
  },
  { _id: false }
);

// Main Order Schema
const OrderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    phone: {
      type: String,
      required: [true, 'Please add a phone number'],
      trim: true,
    },
    items: {
      type: [OrderItemSchema],
      validate: {
        validator: function (items) {
          return items.length > 0;
        },
        message: 'Order must contain at least one item',
      },
      required: [true, 'Please add order items'],
    },
    totalAmountUSD: {
      type: Number,
      required: true,
      min: [0, 'Total amount cannot be negative'],
    },
    totalAmountINR: {
      type: Number,
      required: true,
      min: [0, 'Total amount cannot be negative'],
    },
    discountUSD: {
      type: Number,
      default: 0,
      min: [0, 'Discount cannot be negative'],
    },
    discountINR: {
      type: Number,
      default: 0,
      min: [0, 'Discount cannot be negative'],
    },
    shippingFee: {
      type: Number,
      default: 100,
      min: [0, 'Shipping fee cannot be negative'],
    },
    finalAmount: {
      type: Number,
      required: true,
      min: [0, 'Final amount cannot be negative'],
    },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
      default: 'pending',
    },
    paymentMethod: {
      type: String,
      required: true,
      enum: ['cod', 'card', 'upi', 'netbanking', 'billdesk'],
    },
    paymentStatus: {
      type: String,
      required: true,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },
    shippingAddress: {
      street: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      zip: { type: String, required: true },
      country: { type: String, required: true },
      phone: { type: String, required: true },
    },
    billingAddress: {
      street: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      zip: { type: String, required: true },
      country: { type: String, required: true },
      phone: { type: String, required: true },
    },
    couponCode: {
      type: String,
      default: null,
    },
    paymentDetails: {
      transactionId: { type: String, default: null, trim: true },
      fee: { type: Number, default: 0, min: [0, 'Fee cannot be negative'] },
    },
    cancellationReason: { type: String, default: null },
  },
  {
    timestamps: true,
  }
);

// Method to calculate the total amount before saving
OrderSchema.methods.calculateTotal = function () {
  const USD_TO_INR_RATE = 83;
  const SHIPPING_FEE = 100;

  // Calculate USD total
  const totalUSD = this.items.reduce((acc, item) => {
    if (item.price == null || isNaN(item.price)) {
      throw new Error('Invalid price in order item');
    }
    return acc + (item.price * item.quantity);
  }, 0);

  // Convert to INR
  const totalINR = totalUSD * USD_TO_INR_RATE;

  // Set the amounts
  this.totalAmountUSD = totalUSD;
  this.totalAmountINR = totalINR;
  
  // Calculate final amount (after discount and shipping)
  const amountAfterDiscount = totalINR - (this.discountINR || 0);
  this.finalAmount = amountAfterDiscount + SHIPPING_FEE;
};

// Pre-save hook to calculate total amount and assign order number if not provided
OrderSchema.pre('save', async function (next) {
  if (!this.orderNumber) {
    this.orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }
  this.calculateTotal();
  next();
});

// Indexes for optimized search
OrderSchema.index({ customer: 1, status: 1 });
OrderSchema.index({ orderNumber: 1 });
OrderSchema.index({ createdAt: 1 });

module.exports = mongoose.model('Order', OrderSchema);
