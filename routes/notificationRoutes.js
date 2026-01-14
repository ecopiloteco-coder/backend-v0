const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');

// All routes here are prefixed with /api/notifications
router.get('/', notificationController.getNotifications);
router.put('/:id/read', notificationController.markAsRead);
router.put('/read-all', notificationController.markAllAsRead);

module.exports = router;
