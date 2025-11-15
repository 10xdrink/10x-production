// controllers/billDeskController.js

const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const logger = require('../utils/logger');
const billDeskService = require('../services/billDeskService');

/**
 * Initialize BillDesk payment
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
const initializePayment = async (req, res) => {
  try {
    const { orderId } = req.params;
    logger.info(`Initializing BillDesk payment for order: ${orderId}`);
    
    // Capture actual client IP address
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                     req.headers['x-real-ip'] || 
                     req.connection.remoteAddress || 
                     req.socket.remoteAddress || 
                     req.ip || 
                     '127.0.0.1';
    
    logger.info(`Client IP captured: ${clientIp}`);
    
    // Find order
    const order = await Order.findById(orderId);
    if (!order) {
      logger.error(`Order not found: ${orderId}`);
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    // For testing purposes, we're allowing any user to initialize payment for any order
    // In production, you would want to uncomment this check
    /*
    if (order.customer.toString() !== req.user._id.toString()) {
      logger.error(`User ${req.user._id} attempted to access order ${orderId} belonging to ${order.customer}`);
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    */
    
    // Log that we're bypassing the ownership check for testing
    logger.info(`Bypassing ownership check for order ${orderId} - Testing mode enabled`);
    
    // Update order status to payment_pending
    order.paymentStatus = 'pending';
    await order.save();
    logger.info(`Order ${orderId} status updated to payment_pending`);
    
    // Create BillDesk order using the service with client IP
    try {
      const billDeskOrder = await billDeskService.createPaymentRequest(order, clientIp);
      // Log the complete response structure for debugging
      logger.info(`BillDesk order created successfully for order ${orderId}`);
      logger.info('BillDesk response structure:', JSON.stringify(billDeskOrder, null, 2));
      
      // Check if we got bdOrderId from BillDesk response
      if (!billDeskOrder.bdOrderId && !billDeskOrder.formHtml) {
        throw new Error('BillDesk did not return payment details. Likely authentication issue.');
      }
      
      // Return BillDesk payment data
      res.status(200).json({
        success: true,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          transactionId: billDeskOrder.transactionId,
          paymentData: {
            paymentUrl: billDeskOrder.paymentUrl,
            bdOrderId: billDeskOrder.bdOrderId,
            merchantId: billDeskOrder.merchantId,
            rdata: billDeskOrder.rdata,
            // For API v1.2 flow
            isRedirect: billDeskOrder.isRedirect || false,
            formHtml: billDeskOrder.formHtml || null
          }
        }
      });
    } catch (billDeskError) {
      logger.error(`BillDesk service error: ${billDeskError.message}`);
      res.status(500).json({ success: false, message: billDeskError.message });
    }
  } catch (error) {
    logger.error(`BillDesk payment initialization failed: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Handle BillDesk payment return
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
const handlePaymentReturn = async (req, res) => {
  try {
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
    logger.info(`BillDesk payment return received`);
    
    // Check if we have a response body
    if (!req.body) {
      logger.error('Empty response body from BillDesk');
      return res.redirect(`${FRONTEND_URL}/payment/failed?message=Invalid payment response`);
    }
    
    // Process the return data using the service with JWS verification
    try {
      // Pass the raw response to processResponse which will verify the JWS signature
      const result = await billDeskService.processResponse(req.body);
      
      // Find the order associated with this transaction
      const transaction = await Transaction.findById(result.transactionId);
      if (!transaction) {
        logger.error(`Transaction not found: ${result.transactionId}`);
        return res.redirect(`${FRONTEND_URL}/payment/failed?message=Transaction not found`);
      }
      
      const order = await Order.findOne({ orderNumber: result.orderNumber });
      if (!order) {
        logger.error(`Order not found for transaction: ${result.transactionId}`);
        return res.redirect(`${FRONTEND_URL}/payment/failed?message=Order not found`);
      }
      
      // Update order status based on transaction status
      if (result.status === 'success') {
        order.paymentStatus = 'paid';
        order.status = 'processing';
        await order.save();
        
        // Clear the user's cart after successful payment
        try {
          const Cart = require('../models/Cart');
          const cart = await Cart.findOne({ user: order.customer });
          if (cart) {
            cart.items = [];
            await cart.save();
            logger.info(`Cart cleared for user ${order.customer} after successful payment`);
          }
        } catch (cartError) {
          logger.error(`Failed to clear cart after payment: ${cartError.message}`);
          // Continue even if cart clearing fails - payment was successful
        }
        
        logger.info(`Payment successful for order: ${order._id}`);
        return res.redirect(`${FRONTEND_URL}/thank-you?orderId=${order._id}`);
      } else if (result.status === 'failed') {
        order.paymentStatus = 'failed';
        await order.save();
        
        logger.info(`Payment failed for order: ${order._id}`);
        return res.redirect(`${FRONTEND_URL}/payment/failed?orderId=${order._id}`);
      } else {
        // For pending or other statuses
        order.paymentStatus = 'pending';
        await order.save();
        
        logger.info(`Payment pending for order: ${order._id}`);
        return res.redirect(`${FRONTEND_URL}/payment/pending?orderId=${order._id}`);
      }
    } catch (innerError) {
      logger.error(`Error processing payment return: ${innerError.message}`);
      return res.redirect(`${FRONTEND_URL}/payment/failed?message=${encodeURIComponent(innerError.message)}`);
    }
  } catch (error) {
    logger.error(`BillDesk payment return handling failed: ${error.message}`);
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
    return res.redirect(`${FRONTEND_URL}/payment/failed?message=${encodeURIComponent(error.message)}`);
  }
};

/**
 * Handle BillDesk webhook
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
const handleWebhook = async (req, res) => {
  try {
    logger.info('BillDesk webhook received');
    
    // Check if we have a response body
    if (!req.body) {
      logger.error('Empty webhook payload');
      return res.status(400).json({ success: false, message: 'Empty webhook payload' });
    }
    
    // Process the webhook data using the service with JWS verification
    try {
      // Pass the raw response to processResponse which will verify the JWS signature
      const result = await billDeskService.processResponse(req.body);
      
      // Find the order associated with this transaction
      const order = await Order.findOne({ orderNumber: result.orderNumber });
      if (order) {
        // Update order status based on transaction status
        if (result.status === 'success') {
          order.paymentStatus = 'paid';
          order.status = 'processing';
        } else if (result.status === 'failed') {
          order.paymentStatus = 'failed';
        } else {
          order.paymentStatus = 'pending';
        }
        
        await order.save();
        logger.info(`Order ${order._id} updated with payment status: ${order.paymentStatus}`);
      } else {
        logger.error(`Order not found for transaction: ${result.transactionId}`);
      }
      
      // Acknowledge receipt to BillDesk
      return res.status(200).json({ success: true });
    } catch (innerError) {
      logger.error(`Error processing webhook: ${innerError.message}`);
      return res.status(500).json({ success: false, message: innerError.message });
    }
  } catch (error) {
    logger.error(`BillDesk webhook handling failed: ${error.message}`);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Check payment status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
const checkPaymentStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    logger.info(`Checking payment status for order: ${orderId}`);
    
    // Find order
    const order = await Order.findById(orderId);
    if (!order) {
      logger.error(`Order not found: ${orderId}`);
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    // Check if order belongs to current user
    if (req.user && order.customer && order.customer.toString() !== req.user._id.toString()) {
      logger.error(`User ${req.user._id} attempted to access order ${orderId} belonging to ${order.customer}`);
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    // Find the transaction for this order
    const transaction = await Transaction.findOne({ order: order._id }).sort({ createdAt: -1 });
    
    // Check if the order has a pending payment status and was last updated more than 60 minutes ago
    if (order.paymentStatus === 'pending' && transaction) {
      const lastUpdated = new Date(transaction.updatedAt).getTime();
      const currentTime = new Date().getTime();
      const timeDifference = currentTime - lastUpdated;
      const sixtyMinutesInMs = 60 * 60 * 1000;
      
      if (timeDifference > sixtyMinutesInMs) {
        logger.info(`Order ${orderId} has pending payment status for more than 60 minutes, retrieving status from BillDesk`);
        
        try {
          // Retrieve transaction status from BillDesk
          const transactionStatus = await billDeskService.retrieveTransaction(order.orderNumber);
          
          if (transactionStatus.success) {
            // Update order status based on the retrieved transaction status
            const { status } = transactionStatus.data;
            
            if (status && status.toUpperCase() === 'SUCCESS') {
              order.paymentStatus = 'success';
              transaction.status = 'success';
              await Promise.all([order.save(), transaction.save()]);
              logger.info(`Updated order ${orderId} status to success based on BillDesk transaction status`);
            } else if (status && status.toUpperCase() === 'FAILED') {
              order.paymentStatus = 'failed';
              transaction.status = 'failed';
              await Promise.all([order.save(), transaction.save()]);
              logger.info(`Updated order ${orderId} status to failed based on BillDesk transaction status`);
            }
          } else {
            logger.error(`Failed to retrieve transaction status from BillDesk for order ${orderId}: ${transactionStatus.message}`);
          }
        } catch (txnError) {
          logger.error(`Error retrieving transaction status from BillDesk: ${txnError.message}`);
        }
      }
    }
    
    if (transaction) {
      // Return transaction details
      return res.status(200).json({
        success: true,
        data: {
          status: transaction.status,
          paymentMethod: 'billdesk',
          amount: transaction.amount,
          transactionId: transaction._id,
          billDeskTxnId: transaction.metadata?.billDeskTxnId || null,
          bankTxnId: transaction.metadata?.bankTxnId || null,
          createdAt: transaction.createdAt,
          updatedAt: transaction.updatedAt
        }
      });
    }
    
    // If no transaction found or error checking status, return order payment status
    return res.status(200).json({
      success: true,
      data: {
        status: order.paymentStatus,
        paymentMethod: 'billdesk',
        amount: order.finalAmount,
        orderId: order._id,
        orderNumber: order.orderNumber,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      }
    });
  } catch (error) {
    logger.error(`BillDesk payment status check failed: ${error.message}`);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Proxy the payment request to BillDesk API
 * This avoids CORS issues by having our server make the request
 */
async function proxyPaymentRequest(req, res) {
  try {
    const { paymentUrl, payload, headers } = req.body;
    
    if (!paymentUrl || !payload || !headers) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: paymentUrl, payload, or headers'
      });
    }
    
    logger.info('Proxying payment request to BillDesk API', {
      url: paymentUrl,
      payloadLength: payload.length,
      headers: Object.keys(headers)
    });
    
    // Use node-fetch to make the request
    const fetch = require('node-fetch');
    
    logger.info('Making request to BillDesk API with the following details:', {
      url: paymentUrl,
      method: 'POST',
      headerKeys: Object.keys(headers),
      contentType: headers['Content-Type'],
      payloadLength: payload.length,
      payloadPrefix: payload.substring(0, 50) + '...'
    });
    
    try {
      const response = await fetch(paymentUrl, {
        method: 'POST',
        headers: headers,
        body: payload
      });
      
      logger.info('BillDesk API response received:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries([...response.headers.entries()]),
        redirected: response.redirected,
        redirectUrl: response.redirected ? response.url : null
      });
      
      // Get response data
      const responseData = await response.text();
      const contentType = response.headers.get('content-type');
      
      logger.info('BillDesk API response received', {
        status: response.status,
        contentType,
        responseLength: responseData.length
      });
      
      // Check if we got a redirect
      if (response.redirected) {
        return res.json({
          success: true,
          redirectUrl: response.url
        });
      }
      
      // Check if we got HTML
      if (contentType && contentType.includes('text/html')) {
        return res.json({
          success: true,
          html: responseData
        });
      }
      
      // Check if we got JSON or JOSE
      if (contentType && (contentType.includes('application/json') || contentType.includes('application/jose'))) {
        // Log the response data for debugging
        try {
          const jsonData = JSON.parse(responseData);
          logger.info('BillDesk API JSON response:', jsonData);
        } catch (e) {
          logger.info('BillDesk API response (not JSON):', responseData);
        }
        
        // For JOSE responses, we'll just pass them through
        return res.json({
          success: response.ok,
          data: responseData,
          status: response.status
        });
      }
      
      // Default response
      return res.json({
        success: response.ok,
        status: response.status,
        data: responseData
      });
    } catch (fetchError) {
      logger.error('Error making request to BillDesk API:', fetchError);
      return res.status(500).json({
        success: false,
        message: `Error making request to BillDesk API: ${fetchError.message}`
      });
    }
  } catch (error) {
    logger.error('Error proxying payment request:', error);
    return res.status(500).json({
      success: false,
      message: `Error proxying payment request: ${error.message}`
    });
  }
}

module.exports = {
  initializePayment,
  handlePaymentReturn,
  handleWebhook,
  checkPaymentStatus,
  proxyPaymentRequest
};
