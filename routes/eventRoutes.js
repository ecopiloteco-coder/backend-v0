const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');

// Get all events for a specific project
router.get('/project/:projectId', eventController.getProjectEvents);

module.exports = router;
