const express = require('express');
const router = express.Router();
const projetDetailsController = require('../controllers/projetDetailsController');
const lotController = require('../controllers/lotController');
const ouvrageController = require('../controllers/ouvrageController');
const blocController = require('../controllers/blocController');

// Get full project details
router.get('/:id/details', projetDetailsController.getProjetDetails);

// --- Lots Routes ---
router.post('/lots', lotController.createLot);
router.put('/lots/:id', lotController.updateLot);
router.delete('/lots/:id', lotController.deleteLot);

// --- Ouvrage Routes ---
router.post('/ouvrages', ouvrageController.createOuvrage);
router.put('/ouvrages/:id', ouvrageController.updateOuvrage);
router.delete('/ouvrages/:id', ouvrageController.deleteOuvrage);

// --- Bloc Routes ---
router.post('/blocs', blocController.createBloc);
router.get('/blocs/:id', blocController.getBloc);
router.put('/blocs/:id', blocController.updateBloc);
router.delete('/blocs/:id', blocController.deleteBloc);

// --- Projet Articles ---
router.post('/articles', ouvrageController.createProjetArticle);
router.get('/articles/catalog', ouvrageController.getArticlesCatalogForParent);
router.put('/articles/:id', ouvrageController.updateProjetArticle);
router.delete('/articles/:id', ouvrageController.deleteProjetArticle);

module.exports = router;
