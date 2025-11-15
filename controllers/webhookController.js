// controllers/webhookController.js

const billDeskService = require('../services/billDeskService');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const Product = require('../models/Product');
const logger = require('../utils/logger');

/**
 * Handles BillDesk webhook events.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 */
exports.billDeskWebhook = async (req, res) => {
  try {
    logger.info('BillDesk webhook received');
    
    // Get the response data from BillDesk
    const responseData = req.body;
    
    // Process and verify the BillDesk response
    const result = await billDeskService.processResponse(responseData);
    
    if (!result.success) {
      logger.error('BillDesk webhook processing failed:', result.message);
      return res.status(400).json({ 
        success: false, 
        message: result.message 
      });
    }
    
    // Find the order
    const order = await Order.findOne({ orderNumber: result.orderNumber });
    if (!order) {
      logger.error(`Order not found for orderNumber: ${result.orderNumber}`);
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }
    
    // Update order based on payment status
    if (result.status === 'success') {
      order.paymentStatus = 'paid';
      order.status = 'processing';
      await order.save();
      
      // Deduct stock
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.product, { 
          $inc: { stock: -item.quantity } 
        });
      }
      
      logger.info(`Order ${order.orderNumber} payment succeeded via BillDesk`);
    } else if (result.status === 'failed') {
      order.paymentStatus = 'failed';
      order.status = 'failed';
      await order.save();
      
      logger.info(`Order ${order.orderNumber} payment failed via BillDesk`);
    }
    
    // Return success response to BillDesk
    res.json({ 
      success: true, 
      message: 'Webhook processed successfully',
      orderNumber: result.orderNumber
    });
    
  } catch (error) {
    logger.error('BillDesk webhook error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
};

/**
 * Handles BillDesk return URL (redirect after payment)
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 */
exports.billDeskReturn = async (req, res) => {
  try {
    logger.info('BillDesk return URL accessed');
    
    const responseData = req.query.msg || req.body;
    
    // Process the BillDesk response
    const result = await billDeskService.processResponse(responseData);
    
    // Redirect to frontend with status
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const redirectUrl = `${frontendUrl}/payment-status?status=${result.status}&orderNumber=${result.orderNumber}`;
    
    res.redirect(redirectUrl);
    
  } catch (error) {
    logger.error('BillDesk return URL error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/payment-status?status=error`);
  }
};
