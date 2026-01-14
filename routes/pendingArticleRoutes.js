const express = require('express');
const router = express.Router();
const pendingArticleController = require('../controllers/pendingArticleController');

// Pending article routes
router.get('/', pendingArticleController.getAllPendingArticles);
router.get('/user/:userId', pendingArticleController.getUserPendingArticles);
router.get('/:id', pendingArticleController.getPendingArticleById);
router.put('/:id', pendingArticleController.updatePendingArticle);
router.post('/:id/approve', pendingArticleController.approvePendingArticle);
router.post('/:id/reject', pendingArticleController.rejectPendingArticle);
router.delete('/:id', pendingArticleController.deletePendingArticle);

module.exports = router;
