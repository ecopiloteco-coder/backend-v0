// routes/admin.routes.js
const express = require('express');
const router = express.Router();
const UserController = require('../controllers/UserController');
const { authAdminMiddleware } = require('../middleware/authMiddleware');
const FileWatcherService = require('../services/FileWatcherService');

// Admin-only routes
router.get('/list-employe', authAdminMiddleware, UserController.listEmploye);

router.get('/stats', authAdminMiddleware, UserController.getUserStats);

router.get('/users', authAdminMiddleware, UserController.getAllUsers);
router.get('/users/:id', authAdminMiddleware, UserController.getUserById);

// System Scan Status
router.get('/system/scan-status', authAdminMiddleware, (req, res) => {
    try {
        const status = FileWatcherService.getStatus();
        res.json({ success: true, data: status });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to retrieve scan status', error: error.message });
    }
});

module.exports = router;
