const Order = require('../models/Order');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const Transaction = require('../models/Transaction');
const logger = require('../utils/logger');
const MESSAGES = require('../messages/en');
const ERROR_CODES = require('../constants/errorCodes');
const asyncHandler = require('express-async-handler');
const { processPayment, verifyStripeWebhook, handleStripeEvent, verifyPayPalWebhook, handlePayPalEvent } = require('../services/paymentService');
const { setCache, getCache, deleteCache } = require('../services/redisService');
const crypto = require('crypto');

// Encryption key for sensitive data
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'defaultEncryptionKey123456'; // Replace with a secure key in production
const IV_LENGTH = 16;

// Helper function to encrypt sensitive fields
const encrypt = (text) => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
};

/**
 * @desc    Create a new order
 * @route   POST /api/orders
 * @access  Private/Customer
 */
exports.createOrder = asyncHandler(async (req, res, next) => {
  const { items, shippingAddress, billingAddress, paymentMethod, couponCode } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ success: false, message: 'No items provided for the order.' });
  }

  let totalAmount = 0;
  const populatedItems = [];

  // Validate and calculate total amount
  for (const item of items) {
    const product = await Product.findById(item.product);

    if (!product || !product.isActive) {
      return res.status(400).json({ success: false, message: `Product with ID ${item.product} is invalid.` });
    }

    if (product.stock < item.quantity) {
      return res.status(400).json({ success: false, message: `Insufficient stock for product ${product.name}.` });
    }

    const itemTotal = product.price * item.quantity;
    totalAmount += itemTotal;

    populatedItems.push({
      product: product._id,
      quantity: item.quantity,
      price: product.price,
    });
  }

  // Apply coupon if provided
  let discount = 0;
  if (couponCode) {
    const coupon = await Coupon.findOne({ code: couponCode, isActive: true });

    if (!coupon) {
      return res.status(400).json({ success: false, message: 'Invalid or inactive coupon code.' });
    }

    // Validate coupon usage
    const couponValidation = Coupon.canApplyCoupon(coupon);
    if (!couponValidation.success) {
      return res.status(400).json({ success: false, message: couponValidation.message });
    }

    // Apply coupon
    discount = coupon.discountType === 'percentage' ? (totalAmount * (coupon.discount / 100)) : coupon.discount;
    totalAmount -= discount;

    // Increment used count
    coupon.usedCount += 1;
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      coupon.isActive = false;
    }
    await coupon.save();
  }

  // Create order number
  const orderNumber = `ORD${Date.now()}`;

  const order = await Order.create({
    orderNumber,
    customer: req.user._id,
    items: populatedItems,
    totalAmount,
    paymentMethod,
    shippingAddress,
    billingAddress,
    status: 'pending',
    paymentStatus: 'pending',
    discount,
    couponCode: couponCode || null,
  });

  // Process payment
  try {
    const paymentIntent = await processPayment(order, { paymentMethod });

    if (paymentIntent.status === 'succeeded') {
      // Update order status
      order.paymentStatus = 'paid';
      order.status = 'processing';
      order.paymentDetails = {
        transactionId: encrypt(paymentIntent.id),
        fee: paymentIntent.charges.data[0].balance_transaction, // Example
      };
      await order.save();

      // Create transaction record
      await Transaction.create({
        order: order._id,
        paymentMethod: order.paymentMethod,
        amount: order.finalAmount,
        status: 'completed',
        transactionId: encrypt(paymentIntent.id),
        metadata: paymentIntent,
      });

      // Deduct stock
      await Promise.all(
        populatedItems.map(async (item) => {
          await Product.findByIdAndUpdate(item.product, { $inc: { stock: -item.quantity } });
        })
      );

      // Invalidate cache
      await deleteCache(`orders_${req.user._id}`);
      await deleteCache('all_orders');

      res.status(201).json({
        success: true,
        data: order,
        message: MESSAGES.ORDER.CREATE_SUCCESS,
      });
    } else {
      // Payment failed
      await Order.findByIdAndRemove(order._id);

      res.status(500).json({ success: false, message: MESSAGES.ORDER.PAYMENT_FAILED });
    }
  } catch (error) {
    logger.error('Payment Processing Error:', error);
    await Order.findByIdAndRemove(order._id);

    res.status(500).json({ success: false, message: MESSAGES.ORDER.PAYMENT_FAILED });
  }
});

// @desc    Get all orders with optional filters
// @route   GET /api/orders
// @access  Private/Admin/Order Manager/Analytics Viewer
exports.getAllOrders = asyncHandler(async (req, res, next) => {
  const { status, dateFrom, dateTo, customer, page = 1, limit = 10 } = req.query;
  let filter = {};

  if (status) {
    filter.status = status;
  }

  if (customer) {
    filter.customer = customer;
  }

  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo);
  }

  const skip = (page - 1) * limit;

  const orders = await Order.find(filter)
    .populate('customer', 'name email')
    .populate('items.product', 'name price')
    .sort({ createdAt: -1 })
    .skip(parseInt(skip))
    .limit(parseInt(limit));

  const total = await Order.countDocuments(filter);

  res.status(200).json({
    success: true,
    count: orders.length,
    total,
    data: orders,
    message: MESSAGES.ORDER.FETCH_SUCCESS,
  });
});

// @desc    Get a single order by ID
// @route   GET /api/orders/:id
// @access  Private/Admin/Order Manager/Customer
exports.getOrderById = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id)
    .populate('customer', 'name email')
    .populate('items.product', 'name price');

  if (!order) {
    return res.status(404).json({ success: false, message: MESSAGES.ORDER.ORDER_NOT_FOUND });
  }

  // If the user is a customer, ensure they own the order
  if (req.user.role === 'user' && String(order.customer._id) !== String(req.user._id)) {
    return res.status(403).json({ success: false, message: MESSAGES.GENERAL.FORBIDDEN });
  }

  res.status(200).json({
    success: true,
    data: order,
    message: MESSAGES.ORDER.FETCH_SUCCESS,
  });
});

// @desc    Update order status
// @route   PUT /api/orders/:id/status
// @access  Private/Admin/Order Manager
exports.updateOrderStatus = asyncHandler(async (req, res, next) => {
  const { status } = req.body;

  const order = await Order.findById(req.params.id);

  if (!order) {
    return res.status(404).json({ success: false, message: MESSAGES.ORDER.ORDER_NOT_FOUND });
  }

  // Define allowed status transitions
  const allowedTransitions = {
    pending: ['processing', 'cancelled'],
    processing: ['shipped', 'cancelled'],
    shipped: ['delivered', 'refunded'],
    delivered: ['refunded'],
    cancelled: [],
    refunded: [],
  };

  if (!allowedTransitions[order.status].includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status transition.' });
  }

  order.status = status;

  // Handle specific status changes
  if (status === 'shipped') {
    // Additional logic for shipping
  } else if (status === 'delivered') {
    // Additional logic for delivery
  } else if (status === 'cancelled') {
    // Restock products
    await Promise.all(
      order.items.map(async (item) => {
        await Product.findByIdAndUpdate(item.product, { $inc: { stock: item.quantity } });
      })
    );
  }

  await order.save();

  // Invalidate cache
  await deleteCache(`orders_${req.user._id}`);
  await deleteCache('all_orders');

  res.status(200).json({
    success: true,
    data: order,
    message: MESSAGES.ORDER.UPDATE_SUCCESS,
  });
});

// @desc    Cancel an order
// @route   POST /api/orders/:id/cancel
// @access  Private/Admin/Order Manager
exports.cancelOrder = asyncHandler(async (req, res, next) => {
  const { reason } = req.body;

  const order = await Order.findById(req.params.id);

  if (!order) {
    return res.status(404).json({ success: false, message: MESSAGES.ORDER.ORDER_NOT_FOUND });
  }

  if (order.status === 'cancelled' || order.status === 'refunded') {
    return res.status(400).json({ success: false, message: 'Order is already cancelled or refunded.' });
  }

  order.status = 'cancelled';
  order.paymentStatus = 'refunded'; // Assuming full refund

  await order.save();

  // Restock products
  await Promise.all(
    order.items.map(async (item) => {
      await Product.findByIdAndUpdate(item.product, { $inc: { stock: item.quantity } });
    })
  );

  // Invalidate cache
  await deleteCache(`orders_${req.user._id}`);
  await deleteCache('all_orders');

  res.status(200).json({
    success: true,
    message: MESSAGES.ORDER.CANCEL_SUCCESS,
  });
});

/**
 * @desc    Verify Razorpay payment
 * @route   POST /api/payments/verify-razorpay
 * @access  Private
 */
exports.verifyRazorpayPayment = asyncHandler(async (req, res) => {
  const { orderId, paymentId, signature } = req.body;

  try {
    // Find the order
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Verify the payment signature
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_SECRET)
      .update(`${paymentId}|${orderId}`)
      .digest('hex');

    if (generatedSignature !== signature) {
      return res.status(400).json({ success: false, message: 'Invalid payment signature' });
    }

    // Update order status
    order.paymentStatus = 'paid';
    order.status = 'processing';
    await order.save();

    // Create transaction record
    await Transaction.create({
      order: order._id,
      paymentMethod: 'razorpay',
      amount: order.totalAmount,
      status: 'success',
      transactionId: paymentId
    });

    return res.status(200).json({
      success: true,
      message: 'Payment verified successfully',
      data: { orderId: order._id }
    });
  } catch (error) {
    logger.error(`Razorpay payment verification error: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Payment verification failed' });
  }
});

/**
 * @desc    Handle Razorpay webhook
 * @route   POST /api/payments/webhook/razorpay
 * @access  Public
 */
exports.handleRazorpayWebhook = asyncHandler(async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    
    // Verify webhook signature
    const shasum = crypto.createHmac('sha256', webhookSecret);
    shasum.update(JSON.stringify(req.body));
    const digest = shasum.digest('hex');
    
    if (digest !== signature) {
      logger.error('Razorpay webhook - Invalid signature');
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }
    
    const event = req.body;
    
    // Handle different event types
    if (event.event === 'payment.authorized') {
      const paymentId = event.payload.payment.entity.id;
      const orderId = event.payload.payment.entity.notes.orderId;
      
      // Find the order
      const order = await Order.findById(orderId);
      if (!order) {
        logger.error(`Razorpay webhook - Order not found: ${orderId}`);
        return res.status(200).end(); // Return 200 to acknowledge receipt
      }
      
      // Update order status
      order.paymentStatus = 'paid';
      order.status = 'processing';
      await order.save();
      
      // Create transaction record if not exists
      const transaction = await Transaction.findOne({ 
        order: order._id, 
        transactionId: paymentId 
      });
      
      if (!transaction) {
        await Transaction.create({
          order: order._id,
          paymentMethod: 'razorpay',
          amount: order.totalAmount,
          status: 'success',
          transactionId: paymentId
        });
      }
    }
    
    // Always return a 200 OK to acknowledge receipt
    return res.status(200).json({ success: true });
  } catch (error) {
    logger.error(`Razorpay webhook error: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Webhook processing failed' });
  }
});

/**
 * @desc    Verify Stripe payment
 * @route   POST /api/payments/verify-stripe
 * @access  Private
 */
exports.verifyStripePayment = asyncHandler(async (req, res) => {
  const { paymentIntentId, orderId } = req.body;

  try {
    // Find the order
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Verify the payment with Stripe
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ success: false, message: 'Payment not successful' });
    }

    // Update order status
    order.paymentStatus = 'paid';
    order.status = 'processing';
    await order.save();

    // Create transaction record
    await Transaction.create({
      order: order._id,
      paymentMethod: 'stripe',
      amount: order.totalAmount,
      status: 'success',
      transactionId: paymentIntentId
    });

    return res.status(200).json({
      success: true,
      message: 'Payment verified successfully',
      data: { orderId: order._id }
    });
  } catch (error) {
    logger.error(`Stripe payment verification error: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Payment verification failed' });
  }
});

/**
 * @desc    Handle Stripe webhook
 * @route   POST /api/payments/webhook/stripe
 * @access  Public
 */
exports.handleStripeWebhook = asyncHandler(async (req, res) => {
  try {
    // Verify the webhook signature
    const event = await verifyStripeWebhook(req);
    
    // Process the webhook event
    await handleStripeEvent(event);
    
    // Return a 200 OK response
    return res.status(200).json({ success: true });
  } catch (error) {
    logger.error(`Stripe webhook error: ${error.message}`);
    return res.status(400).json({ success: false, message: 'Webhook verification failed' });
  }
});

/**
 * @desc    Verify PayPal payment
 * @route   POST /api/payments/verify-paypal
 * @access  Private
 */
exports.verifyPayPalPayment = asyncHandler(async (req, res) => {
  const { paymentId, orderId } = req.body;

  try {
    // Find the order
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Verify the payment with PayPal
    const paypal = require('paypal-rest-sdk');
    paypal.configure({
      mode: process.env.PAYPAL_MODE || 'sandbox',
      client_id: process.env.PAYPAL_CLIENT_ID,
      client_secret: process.env.PAYPAL_CLIENT_SECRET
    });

    paypal.payment.get(paymentId, async (error, payment) => {
      if (error) {
        logger.error(`PayPal payment verification error: ${error.message}`);
        return res.status(400).json({ success: false, message: 'Payment verification failed' });
      }
      
      if (payment.state !== 'approved') {
        return res.status(400).json({ success: false, message: 'Payment not approved' });
      }
      
      // Update order status
      order.paymentStatus = 'paid';
      order.status = 'processing';
      await order.save();

      // Create transaction record
      await Transaction.create({
        order: order._id,
        paymentMethod: 'paypal',
        amount: order.totalAmount,
        status: 'success',
        transactionId: paymentId
      });

      return res.status(200).json({
        success: true,
        message: 'Payment verified successfully',
        data: { orderId: order._id }
      });
    });
  } catch (error) {
    logger.error(`PayPal payment verification error: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Payment verification failed' });
  }
});

/**
 * @desc    Handle PayPal webhook
 * @route   POST /api/payments/webhook/paypal
 * @access  Public
 */
exports.handlePayPalWebhook = asyncHandler(async (req, res) => {
  try {
    // Verify the webhook
    const event = await verifyPayPalWebhook(req);
    
    // Process the webhook event
    await handlePayPalEvent(event);
    
    // Return a 200 OK response
    return res.status(200).json({ success: true });
  } catch (error) {
    logger.error(`PayPal webhook error: ${error.message}`);
    return res.status(400).json({ success: false, message: 'Webhook verification failed' });
  }
});
