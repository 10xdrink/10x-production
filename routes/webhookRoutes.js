// routes/webhookRoutes.js

const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const bodyParser = require('body-parser');

// BillDesk webhook endpoint
router.post(
  '/billdesk',
  bodyParser.json(),
  webhookController.billDeskWebhook
);

// BillDesk return URL (redirect after payment)
router.get(
  '/billdesk/return',
  webhookController.billDeskReturn
);

router.post(
  '/billdesk/return',
  bodyParser.json(),
  bodyParser.urlencoded({ extended: true }),
  webhookController.billDeskReturn
);

module.exports = router;
