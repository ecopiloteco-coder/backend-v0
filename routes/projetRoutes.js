const express = require('express');
const router = express.Router();
const projetController = require('../controllers/projetController');
const importController = require('../controllers/importController');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Get all projects
router.get('/', projetController.getAllProjets);

// Get specific project
router.get('/:id', projetController.getProjetById);

// Create project
router.post('/', projetController.createProjet);

// Update project
router.put('/:id', projetController.updateProjet);

// Delete project
router.delete('/:id', projetController.deleteProjet);

// Import DPGF Routes
router.post('/preview-dpgf', upload.single('file'), importController.previewDPGF);
router.post('/preview-dpgf-sheet', upload.single('file'), importController.previewDPGFSheetStructure);
router.post('/parse-dpgf', upload.single('file'), importController.parseDPGF);
router.post('/:id/import-dpgf-data', importController.importDPGFData);

module.exports = router;
