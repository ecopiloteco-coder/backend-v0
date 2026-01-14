const Notification = require('../models/Notification');
const Event = require('../models/Event');

function broadcastToUser(userId, eventName, data) {
    try {
        const subs = global.userSubscribers?.get(userId.toString());
        if (!subs || subs.size === 0) return;
        const payload = JSON.stringify(data ?? {});
        subs.forEach((clientRes) => {
            try {
                clientRes.write(`event: ${eventName}\n`);
                clientRes.write(`data: ${payload}\n\n`);
            } catch (err) {
                console.error('SSE send error:', err);
            }
        });
    } catch (err) {
        console.error('Error broadcasting SSE:', err);
    }
}

/**
 * Get notifications for the current user
 */
exports.getUserNotifications = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { limit = 50, offset = 0, unreadOnly = false } = req.query;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        try {
            const notifications = await Notification.findByUser(userId, {
                limit: parseInt(limit, 10),
                offset: parseInt(offset, 10),
                unreadOnly: unreadOnly === 'true'
            });
            res.json({ notifications: notifications || [] });
        } catch (dbError) {
            // Fallback for database permission issues
            console.log('Notifications temporarily disabled due to DB permissions:', dbError.message);
            res.json({ notifications: [] });
        }
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
};

/**
 * Get unread notification count
 */
exports.getUnreadCount = async (req, res) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        try {
            const count = await Notification.getUnreadCount(userId);
            res.json({ count: count || 0 });
        } catch (dbError) {
            // Fallback for database permission issues
            console.log('Unread count temporarily disabled due to DB permissions:', dbError.message);
            res.json({ count: 0 });
        }
    } catch (error) {
        console.error('Error fetching unread count:', error);
        res.status(500).json({ error: 'Failed to fetch unread count' });
    }
};

/**
 * Mark notification as read
 */
exports.markAsRead = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { notificationId } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const notification = await Notification.markAsRead(notificationId, userId);

        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        let unreadCount = null;
        try {
            unreadCount = await Notification.getUnreadCount(userId);
        } catch (err) {}
        broadcastToUser(userId, 'notification_read', {
            id_notif: Number(notification.id_notif) || Number(notificationId),
            unreadCount: typeof unreadCount === 'number' ? unreadCount : undefined
        });

        res.json({ success: true, notification });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ error: 'Failed to mark notification as read' });
    }
};

/**
 * Mark all notifications as read
 */
exports.markAllAsRead = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { projectId } = req.query;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const count = await Notification.markAllAsRead(
            userId, 
            projectId ? parseInt(projectId, 10) : null
        );

        let unreadCount = null;
        try {
            unreadCount = await Notification.getUnreadCount(userId);
        } catch (err) {}
        broadcastToUser(userId, 'notifications_mark_all_read', {
            projectId: projectId ? parseInt(projectId, 10) : null,
            count,
            unreadCount: typeof unreadCount === 'number' ? unreadCount : undefined
        });

        res.json({ success: true, count });
    } catch (error) {
        console.error('Error marking all as read:', error);
        res.status(500).json({ error: 'Failed to mark all as read' });
    }
};

/**
 * Delete notification
 */
exports.deleteNotification = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { notificationId } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const deleted = await Notification.delete(notificationId, userId);

        if (!deleted) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        let unreadCount = null;
        try {
            unreadCount = await Notification.getUnreadCount(userId);
        } catch (err) {}
        broadcastToUser(userId, 'notification_deleted', {
            id_notif: Number(notificationId),
            unreadCount: typeof unreadCount === 'number' ? unreadCount : undefined
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ error: 'Failed to delete notification' });
    }
};

/**
 * Get notifications for a specific project
 */
exports.getProjectNotifications = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { projectId } = req.params;
        const { limit = 50, offset = 0 } = req.query;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const notifications = await Notification.findByProjectAndUser(
            projectId,
            userId,
            {
                limit: parseInt(limit, 10),
                offset: parseInt(offset, 10)
            }
        );

        res.json({ notifications: notifications || [] });
    } catch (error) {
        console.error('Error fetching project notifications:', error);
        res.status(500).json({ error: 'Failed to fetch project notifications' });
    }
};

/**
 * Subscribe to Web Push Notifications
 */
exports.subscribeToPush = async (req, res) => {
    try {
        const userId = req.user?.id;
        const subscription = req.body;

        if (!userId || !subscription || !subscription.endpoint) {
            return res.status(400).json({ error: 'Invalid subscription' });
        }

        // Initialize global push subscriptions map if not exists
        if (!global.pushSubscriptions) {
            global.pushSubscriptions = new Map();
        }

        const uid = userId.toString();
        let userSubs = global.pushSubscriptions.get(uid) || [];
        
        // Add if not exists
        const exists = userSubs.some(s => s.endpoint === subscription.endpoint);
        if (!exists) {
            userSubs.push(subscription);
            global.pushSubscriptions.set(uid, userSubs);
        }

        console.log(`✅ User ${uid} subscribed to Web Push. Total subs: ${userSubs.length}`);
        res.status(201).json({ success: true });
    } catch (error) {
        console.error('Error subscribing to push:', error);
        res.status(500).json({ error: 'Failed to subscribe' });
    }
};

/**
 * SSE endpoint for real-time notifications
 */
exports.subscribeToNotifications = (req, res) => {
    let userId = req.user?.id;
    const { projectId, token } = req.query;

    // If no user from auth middleware, try token from query parameter
    if (!userId && token) {
        try {
            const jwt = require('jsonwebtoken');
            const jwtSecret = process.env.JWT_SECRET || 'dev-insecure-secret';
            const decoded = jwt.verify(token, jwtSecret);
            req.user = decoded;
        } catch (error) {
            console.error('Token verification failed for SSE:', error.message);
            return res.status(401).json({ error: 'Invalid token' });
        }
    }

    if (!req.user?.id) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    userId = req.user.id;

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Initialize global subscribers map if not exists
    if (!global.projectSubscribers) {
        global.projectSubscribers = new Map();
    }
    if (!global.userSubscribers) {
        global.userSubscribers = new Map();
    }
    // Track active user sessions (any stream type)
    if (!global.activeUsers) {
        global.activeUsers = new Map();
    }

    // Add to active users count
    const uid = userId.toString();
    const currentCount = global.activeUsers.get(uid) || 0;
    global.activeUsers.set(uid, currentCount + 1);
    console.log(`🔌 User ${uid} connected. Active sessions: ${currentCount + 1}`);

    // Add to subscribers for the specific project
    if (projectId) {
        const projId = projectId.toString();
        if (!global.projectSubscribers.has(projId)) {
            global.projectSubscribers.set(projId, new Set());
        }
        const subscribers = global.projectSubscribers.get(projId);
        subscribers.add(res);

        // Send recent events as backlog (last 5 minutes)
        Event.findRecentByProject(projectId, 5)
            .then(events => {
                if (events.length > 0) {
                    res.write(`event: backlog\n`);
                    res.write(`data: ${JSON.stringify(events)}\n\n`);
                }
            })
            .catch(err => console.error('Error fetching recent events:', err));
    } else {
        const uid = userId.toString();
        if (!global.userSubscribers.has(uid)) {
            global.userSubscribers.set(uid, new Set());
        }
        const subscribers = global.userSubscribers.get(uid);
        subscribers.add(res);

        Notification.findByUser(userId, { limit: 50, offset: 0, unreadOnly: false })
            .then((notifications) => {
                if (Array.isArray(notifications) && notifications.length > 0) {
                    res.write(`event: backlog\n`);
                    res.write(`data: ${JSON.stringify(notifications)}\n\n`);
                }
            })
            .catch(err => console.error('Error fetching recent notifications:', err));
    }

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
        try {
            res.write(':heartbeat\n\n');
        } catch (err) {
            clearInterval(heartbeat);
        }
    }, 20000);

    // Cleanup on disconnect
    req.on('close', () => {
        clearInterval(heartbeat);
        
        // Decrement active user count
        const uid = userId.toString();
        if (global.activeUsers) {
            const count = global.activeUsers.get(uid) || 0;
            if (count <= 1) {
                global.activeUsers.delete(uid);
                console.log(`🔌 User ${uid} disconnected. No active sessions.`);
            } else {
                global.activeUsers.set(uid, count - 1);
                console.log(`🔌 User ${uid} disconnected. Remaining sessions: ${count - 1}`);
            }
        }

        if (projectId) {
            const projId = projectId.toString();
            const subscribers = global.projectSubscribers.get(projId);
            if (subscribers) {
                subscribers.delete(res);
                if (subscribers.size === 0) {
                    global.projectSubscribers.delete(projId);
                }
            }
        } else {
            const uid = userId.toString();
            const subscribers = global.userSubscribers.get(uid);
            if (subscribers) {
                subscribers.delete(res);
                if (subscribers.size === 0) {
                    global.userSubscribers.delete(uid);
                }
            }
        }
    });
};
