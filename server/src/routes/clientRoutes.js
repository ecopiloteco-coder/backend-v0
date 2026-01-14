const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const clientController = require('../controllers/clientController');

/**
 * @route   GET /api/clients
 * @desc    Get all clients with pagination and search
 * @access  Private
 */
router.get('/', authMiddleware, clientController.getAllClients);

/**
 * @route   GET /api/clients/:id
 * @desc    Get client by ID
 * @access  Private
 */
router.get('/:id', authMiddleware, clientController.getClientById);

/**
 * @route   POST /api/clients
 * @desc    Create a new client
 * @access  Private (Admin only)
 */
router.post('/', authMiddleware, clientController.createClient);

/**
 * @route   PUT /api/clients/:id
 * @desc    Update client
 * @access  Private (Admin only)
 */
router.put('/:id', authMiddleware, clientController.updateClient);

/**
 * @route   DELETE /api/clients/:id
 * @desc    Delete client
 * @access  Private (Admin only)
 */
router.delete('/:id', authMiddleware, clientController.deleteClient);

module.exports = router;
