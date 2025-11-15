// routes/contactRoutes.js

const express = require('express');
const { 
  submitContactMessage,
  getContactMessages,
  getContactMessage,
  updateContactMessage,
  deleteContactMessage,
  replyToContactMessage 
} = require('../controllers/ContactController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const USER_ROLES = require('../constants/userRoles');

const router = express.Router();

// Submit contact message (Public)
router.post('/', submitContactMessage);

// Admin routes - protected with authentication and admin role
router.use(authMiddleware);
router.use(adminMiddleware([USER_ROLES.SUPER_ADMIN, USER_ROLES.MARKETING_MANAGER, USER_ROLES.CONTENT_MANAGER]));

router.get('/', getContactMessages);
router.get('/:id', getContactMessage);
router.put('/:id', updateContactMessage);
router.delete('/:id', deleteContactMessage);
router.post('/:id/reply', replyToContactMessage);

module.exports = router;
