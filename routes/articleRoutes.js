const express = require('express');
const router = express.Router();
const articleController = require('../controllers/articleController');
const { validateArticle } = require('../middleware/validation');

// Article routes
router.post('/', validateArticle, articleController.createArticle);
router.get('/', articleController.getAllArticles);
router.get('/names', articleController.getArticleNames);
router.get('/units', articleController.getUniqueUnits);
router.get('/:id', articleController.getArticleById);
router.put('/:id', articleController.updateArticle);
router.delete('/:id', articleController.deleteArticle);

module.exports = router;
