// routes/emailListRoutes.js

const express = require('express');
const router = express.Router();
const { 
  addSubscriber, 
  getSubscribers, 
  getSubscriber, 
  updateSubscriber, 
  deleteSubscriber, 
  bulkDeleteSubscribers,
  exportSubscribers
} = require('../controllers/emailListController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const USER_ROLES = require('../constants/userRoles');

// Public routes
router.post('/', addSubscriber);

// Admin routes - protected with authentication and admin role
router.use(authMiddleware);
router.use(adminMiddleware([USER_ROLES.SUPER_ADMIN, USER_ROLES.MARKETING_MANAGER, USER_ROLES.CONTENT_MANAGER]));

router.delete('/bulk', bulkDeleteSubscribers);
router.get('/', getSubscribers);
router.get('/export', exportSubscribers);
router.get('/:id', getSubscriber);
router.put('/:id', updateSubscriber);
router.delete('/:id', deleteSubscriber);

module.exports = router;
