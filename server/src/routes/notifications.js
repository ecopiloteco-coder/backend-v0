const express = require('express');
const notificationController = require('../controllers/notificationController');
const eventController = require('../controllers/eventController');
const { authMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

// ==================== NOTIFICATION ROUTES ====================

// Get all notifications for current user
router.get('/', authMiddleware, notificationController.getUserNotifications);

// Get unread notification count
router.get('/unread-count', authMiddleware, notificationController.getUnreadCount);

// Mark notification as read
router.put('/:notificationId/read', authMiddleware, notificationController.markAsRead);

// Mark all notifications as read (optionally filtered by projectId query param)
router.put('/mark-all-read', authMiddleware, notificationController.markAllAsRead);

// Delete notification
router.delete('/:notificationId', authMiddleware, notificationController.deleteNotification);

// Get notifications for a specific project
router.get('/project/:projectId', authMiddleware, notificationController.getProjectNotifications);

// SSE stream for real-time notifications - handle auth manually in controller
router.get('/stream', notificationController.subscribeToNotifications);

// Real-time unread count updates (SSE alias)
router.get('/unread-count/stream', notificationController.subscribeToNotifications);

// Subscribe to Web Push Notifications
router.post('/subscribe', authMiddleware, notificationController.subscribeToPush);

// ==================== EVENT ROUTES ====================

// Create a new event (and notify relevant users)
router.post('/events', authMiddleware, eventController.createEvent);

// Get events for a project
router.get('/events/project/:projectId', authMiddleware, eventController.getProjectEvents);

// Get recent events for a project
router.get('/events/project/:projectId/recent', authMiddleware, eventController.getRecentProjectEvents);

module.exports = router;
