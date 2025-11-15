// controllers/testController.js

const Order = require('../models/Order');
const User = require('../models/User');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

/**
 * Create a test order for payment testing
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
const createTestOrder = async (req, res) => {
  try {
    const { amount, customerId, testOrderId } = req.body;
    
    if (!amount) {
      return res.status(400).json({ success: false, message: 'Amount is required' });
    }
    
    // Generate a unique order number
    const orderNumber = testOrderId || `TEST-${Date.now().toString().slice(-8)}-${Math.floor(Math.random() * 10000)}`;
    
    // Find or create a test user
    let testUser;
    try {
      testUser = await User.findOne({ email: 'test@example.com' });
      
      if (!testUser) {
        testUser = new User({
          name: 'Test User',
          email: 'test@example.com',
          password: 'password123', // This would be hashed by the User model
          role: 'customer'
        });
        await testUser.save();
        logger.info(`Created test user with ID: ${testUser._id}`);
      }
    } catch (userError) {
      logger.error(`Error finding/creating test user: ${userError.message}`);
      // If we can't find/create a user, use a default ObjectId
      testUser = { _id: new mongoose.Types.ObjectId() };
    }
    
    // Calculate amounts properly
    const itemPrice = parseFloat(amount);
    
    // Create a test order
    const testOrder = new Order({
      customer: testUser._id,
      orderNumber: orderNumber,
      phone: '9876543210', // Required field
      items: [{
        product: new mongoose.Types.ObjectId(),
        quantity: 1,
        price: itemPrice,
        variant: 'Regular',
        packaging: 'Standard'
      }],
      shippingAddress: {
        street: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        zip: '12345',
        country: 'India',
        phone: '9876543210'
      },
      billingAddress: {
        street: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        zip: '12345',
        country: 'India',
        phone: '9876543210'
      },
      totalAmount: itemPrice, // This is required by the schema
      discount: 0,
      shippingFee: 0,
      paymentMethod: 'billdesk',
      paymentStatus: 'pending',
      status: 'pending'
    });
    
    await testOrder.save();
    logger.info(`Created test order with ID: ${testOrder._id}`);
    
    res.status(201).json({
      success: true,
      message: 'Test order created successfully',
      data: {
        orderId: testOrder._id,
        orderNumber: testOrder.orderNumber,
        amount: testOrder.finalAmount
      }
    });
  } catch (error) {
    logger.error(`Test order creation failed: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createTestOrder
};
