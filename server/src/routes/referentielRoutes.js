const express = require('express');
const router = express.Router();
const ReferentielController = require('../controllers/referentielController');

/**
 * Référentiel Routes
 * Hierarchical navigation through niveau_1 to niveau_6 and articles
 * 
 * Routes:
 * GET /api/referentiel/niveau1 - Get all niveau_1 records
 * GET /api/referentiel/niveau2?parent=X - Get niveau_2 where id_niv_1=X
 * GET /api/referentiel/niveau3?parent=X - Get niveau_3 where id_niv_2=X
 * GET /api/referentiel/niveau4?parent=X - Get niveau_4 where id_niv_3=X
 * GET /api/referentiel/niveau5?parent=X - Get niveau_5 where id_niv_4=X
 * GET /api/referentiel/niveau6?parent=X - Get niveau_6 where id_niv_5=X
 * GET /api/referentiel/articles?niveau6=X - Get articles where id_niv_6=X
 */

// Get all niveau_1 records
router.get('/niveau1', ReferentielController.getNiveau1);

// Get niveau_2 by parent niveau_1 id
router.get('/niveau2', ReferentielController.getNiveau2);

// Get niveau_3 by parent niveau_2 id
router.get('/niveau3', ReferentielController.getNiveau3);

// Get niveau_4 by parent niveau_3 id
router.get('/niveau4', ReferentielController.getNiveau4);

// Get niveau_5 by parent niveau_4 id
router.get('/niveau5', ReferentielController.getNiveau5);

// Get niveau_6 by parent niveau_5 id
router.get('/niveau6', ReferentielController.getNiveau6);

// Get niveau_5 that skip niveau_4 (directly under niveau_3)
router.get('/niveau5-by-niveau3', ReferentielController.getNiveau5ByNiveau3);

// Get niveau_6 that skip niveau_5 (directly under niveau_4)
router.get('/niveau6-by-niveau4', ReferentielController.getNiveau6ByNiveau4);

// Get niveau_6 that skip niveau_4 and niveau_5 (directly under niveau_3)
router.get('/niveau6-by-niveau3', ReferentielController.getNiveau6ByNiveau3);

// Get articles by niveau_6 id
router.get('/articles', ReferentielController.getArticles);

module.exports = router;

