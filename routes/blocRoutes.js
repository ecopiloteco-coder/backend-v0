const express = require('express');
const router = express.Router();
const blocController = require('../controllers/blocController');

// Create a new bloc
router.post('/', blocController.createBloc);

// Get a single bloc by ID
router.get('/:id', blocController.getBloc);

// Update a bloc
router.put('/:id', blocController.updateBloc);

// Delete a bloc
router.delete('/:id', blocController.deleteBloc);

module.exports = router;