const express = require('express');
const router = express.Router();
const { authMiddleware, adminMiddleware } = require('../middleware/authMiddleware');
const pendingArticleController = require('../controllers/pendingArticleController');
const multer = require('multer');
const parseFieldsOnly = multer().none();

// Multer removed: expect client-side uploaded URLs via file_urls

// Debug route to test middleware behavior
router.post('/debug', pendingArticleController.debugRoute);

// Debug route with Multer
router.post('/debug-multer', (req, res) => {
    res.json({ message: 'Multer disabled. Use file_urls with direct browser uploads.' });
});

// Test HTML form for debugging
router.get('/test-form', pendingArticleController.testFormHtml);

// Test route to verify the router is working
router.get('/test', pendingArticleController.testRoute);

// Test POST route without file upload to debug
router.post('/test', pendingArticleController.testPostRoute);

// Test file upload route
router.post('/test-upload', (req, res) => {
    res.json({ message: 'Multer disabled. Use file_urls with direct browser uploads.' });
});

// Simple file upload test without auth
router.post('/test-simple', (req, res) => {
    res.json({ success: true, message: 'Multer disabled. Use file_urls with direct browser uploads.' });
});

// Get pending articles for the authenticated user
router.get('/mine', authMiddleware, pendingArticleController.getUserPendingArticles);

// Get all pending articles (admin only)
router.get('/', authMiddleware, adminMiddleware, pendingArticleController.getAllPendingArticles);

// Get count of pending articles excluding approved (admin only)
router.get('/count', authMiddleware, adminMiddleware, pendingArticleController.getPendingCount);

// Get single pending article by ID
router.get('/:id', authMiddleware, pendingArticleController.getPendingArticleById);

// Get single deleted (archived) article by ID
router.get('/deleted/:id', authMiddleware, pendingArticleController.getDeletedArticleById);

// Files are now served directly from Supabase URLs, no need for binary file serving routes

// Create new pending article
router.post('/', authMiddleware, parseFieldsOnly, pendingArticleController.createPendingArticle);

// Update pending article
router.put('/:id', authMiddleware, parseFieldsOnly, pendingArticleController.updatePendingArticle);

// Approve pending article (admin only)
router.post('/:id/approve', authMiddleware, adminMiddleware, pendingArticleController.approvePendingArticle);

// Reject pending article (admin only)
router.post('/:id/reject', authMiddleware, adminMiddleware, pendingArticleController.rejectPendingArticle);

// Delete pending article (admin only)
router.delete('/:id', authMiddleware, adminMiddleware, pendingArticleController.deletePendingArticle);

module.exports = router;