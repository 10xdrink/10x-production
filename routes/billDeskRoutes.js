// routes/billDeskRoutes.js

const express = require('express');
const router = express.Router();

// Import the auth middleware (default export)
const protect = require('../middleware/authMiddleware');

// Import your controller methods
const {
  initializePayment,
  checkPaymentStatus,
  handlePaymentReturn,
  handleWebhook,
  proxyPaymentRequest
} = require('../controllers/billDeskController');

// Protected endpoints
router.post('/initialize/:orderId', protect, initializePayment);
router.get('/status/:orderId', protect, checkPaymentStatus);

// Public callbacks from BillDesk
router.post('/return', handlePaymentReturn);
router.post('/webhook', handleWebhook);

// Proxy endpoint for frontend to make BillDesk API calls
router.post('/proxy', proxyPaymentRequest);

module.exports = router;
