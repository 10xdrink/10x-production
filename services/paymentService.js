// services/paymentService.js

const logger = require('../utils/logger');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const billDeskService = require('./billDeskService');

// Get the active payment method from environment
const PAYMENT_METHOD = process.env.PAYMENT_METHOD || 'billdesk';

// Log the active payment method
logger.info(`Payment method configured: ${PAYMENT_METHOD}`);

/**
 * Process a payment using BillDesk or COD
 * @param {Object} order - The order object
 * @param {Object} paymentDetails - Payment specific details
 * @param {string} paymentDetails.paymentMethod - 'billdesk' or 'cod'
 * @returns {Promise<Object>} - Payment result
 */
const processPayment = async (order, paymentDetails) => {
  const { paymentMethod } = paymentDetails;

  if (paymentMethod === 'billdesk') {
    return await processBillDeskPayment(order, paymentDetails);
  } else if (paymentMethod === 'cod') {
    return await processCODPayment(order, paymentDetails);
  } else {
    throw new Error('Unsupported payment method. Use "billdesk" or "cod"');
  }
};

/**
 * Process Cash on Delivery payment
 * @param {Object} order 
 * @param {Object} paymentDetails 
 * @returns {Promise<Object>}
 */
const processCODPayment = async (order, paymentDetails) => {
  try {
    // Create a transaction record for COD
    const transaction = await Transaction.create({
      order: order._id,
      paymentMethod: 'cod',
      amount: order.finalAmount,
      status: 'pending',
      transactionId: `COD-${order.orderNumber}`,
      metadata: { paymentOnDelivery: true },
    });

    // Update order status
    order.paymentStatus = 'pending';
    order.status = 'confirmed';
    order.paymentMethod = 'cod';
    await order.save();

    logger.info(`COD payment processed for order ${order._id}`);

    return {
      success: true,
      message: 'Order placed successfully. Payment will be collected on delivery.',
      order,
      transaction
    };
  } catch (error) {
    logger.error(`COD payment processing failed for order ${order._id}: ${error.message}`);
    throw new Error('COD payment processing failed');
  }
};



/**
 * Process payment using BillDesk
 * @param {Object} order 
 * @param {Object} paymentDetails 
 * @returns {Promise<Object>}
 */
const processBillDeskPayment = async (order, paymentDetails) => {
  try {
    // Create BillDesk order
    const billDeskOrder = await billDeskService.createOrder(order);
    
    logger.info(`BillDesk payment initiated for order ${order._id}: ${billDeskOrder.bdOrderId}`);
    
    return {
      success: true,
      paymentData: {
        bdOrderId: billDeskOrder.bdOrderId,
        merchantId: billDeskOrder.merchantId,
        rdata: billDeskOrder.rdata
      }
    };
  } catch (error) {
    logger.error(`BillDesk payment failed for order ${order._id}: ${error.message}`);
    throw new Error('BillDesk payment failed');
  }
};

/**
 * Verify BillDesk webhook
 * @param {Object} req - Express request object
 * @returns {Promise<Object>} - Processed webhook data
 */
const verifyBillDeskWebhook = async (req) => {
  try {
    return await billDeskService.processWebhook(req);
  } catch (error) {
    logger.error(`BillDesk webhook verification failed: ${error.message}`);
    throw new Error('BillDesk webhook verification failed');
  }
};

/**
 * Handle BillDesk webhook event
 * @param {Object} data - Webhook data
 * @returns {Promise<void>}
 */
const handleBillDeskEvent = async (data) => {
  try {
    return await billDeskService.handleTransactionStatus(data);
  } catch (error) {
    logger.error(`BillDesk event handling failed: ${error.message}`);
    throw new Error('BillDesk event handling failed');
  }
};

/**
 * Exported functions
 */
module.exports = {
  processPayment,
  processBillDeskPayment,
  processCODPayment,
  verifyBillDeskWebhook,
  handleBillDeskEvent,
};
