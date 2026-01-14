const express = require('express');
const router = express.Router();
const niveauController = require('../controllers/niveauController');

// Get complete hierarchy
router.get('/', niveauController.getAllNiveaux);

// Get children of specific niveau
router.get('/:level/:id/children', niveauController.getNiveauChildren);

// Get specific niveau levels
router.get('/1', niveauController.getNiveau1);
router.get('/2', niveauController.getNiveau2);
router.get('/3', niveauController.getNiveau3);
router.get('/4', niveauController.getNiveau4);
router.get('/5', niveauController.getNiveau5);
router.get('/6', niveauController.getNiveau6);

module.exports = router;
