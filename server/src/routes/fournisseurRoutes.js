const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const fournisseurController = require('../controllers/fournisseurController');

/**
 * @route   GET /api/fournisseurs
 * @desc    Get all fournisseurs with pagination and search
 * @access  Private
 */
router.get('/', authMiddleware, fournisseurController.getAllFournisseurs);

/**
 * @route   GET /api/fournisseurs/lots
 * @desc    Get lots (niveau 2) from articles for dropdown
 * @access  Private
 */
router.get('/lots', authMiddleware, fournisseurController.getLots);

/**
 * @route   GET /api/fournisseurs/dropdown
 * @desc    Get fournisseurs for dropdown (id, nom_fournisseur, type)
 * @access  Private
 */
router.get('/dropdown', authMiddleware, fournisseurController.getFournisseursForDropdown);

/**
 * @route   GET /api/fournisseurs/:id
 * @desc    Get fournisseur by ID
 * @access  Private
 */
router.get('/:id', authMiddleware, fournisseurController.getFournisseurById);

/**
 * @route   POST /api/fournisseurs
 * @desc    Create a new fournisseur
 * @access  Private (Admin only)
 */
router.post('/', authMiddleware, fournisseurController.createFournisseur);

/**
 * @route   PUT /api/fournisseurs/:id
 * @desc    Update fournisseur
 * @access  Private (Admin only)
 */
router.put('/:id', authMiddleware, fournisseurController.updateFournisseur);

/**
 * @route   DELETE /api/fournisseurs/:id
 * @desc    Delete fournisseur
 * @access  Private (Admin only)
 */
router.delete('/:id', authMiddleware, fournisseurController.deleteFournisseur);

module.exports = router;
