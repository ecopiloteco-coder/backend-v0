const express = require('express');
const router = express.Router();
const ouvrageController = require('../controllers/ouvrageController');

// Create a new ouvrage
router.post('/', ouvrageController.createOuvrage);

// Update an ouvrage
router.put('/:id', ouvrageController.updateOuvrage);

// Delete an ouvrage
router.delete('/:id', ouvrageController.deleteOuvrage);

module.exports = router;