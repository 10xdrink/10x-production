// routes/testRoutes.js

const express = require('express');
const router = express.Router();
const { createTestOrder } = require('../controllers/testController');

// Public test endpoints
router.post('/orders', createTestOrder);

module.exports = router;
