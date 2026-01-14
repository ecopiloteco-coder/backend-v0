const express = require('express');
const router = express.Router();
const articleController = require('../controllers/articleController');
const { authMiddleware } = require('../middleware/authMiddleware'); // adjust path
const pool = require('../../config/db'); // Fixed path to db config
const multer = require('multer');
const parseFieldsOnly = multer().none();

// Multer removed: switch to direct browser uploads via signed URLs

// Existing routes
router.get('/suggestions', articleController.getSuggestions);
router.get('/', articleController.getAllArticles);
// Place specific routes BEFORE dynamic :id so they don't get intercepted
router.get('/search/niveau1', articleController.searchNiveau1);
router.get('/search/niveau2', articleController.searchNiveau2);
router.get('/niveau2-options', articleController.getNiveau2Options);
router.get('/search/niveau3', articleController.searchNiveau3);
router.get('/search/niveau4', articleController.searchNiveau4);
router.get('/search/niveau5', articleController.searchNiveau5);
router.get('/search/niveau6', articleController.searchNiveau6);
router.get('/search/niveau7', articleController.searchNiveau7);
router.get('/search/unite', articleController.searchUnite);
router.get('/search/name', articleController.searchNiveau7);

router.get('/search/origine-prestation', articleController.searchOriginePrestation);
// Dynamic id must be last among GET routes
router.get('/:id', articleController.getArticleById);
// Accept JSON or multipart/form-data with only text fields (no files)
router.post('/', authMiddleware, parseFieldsOnly, articleController.createArticle);

// Route to serve/download stored files
router.get('/:id/files', async (req, res) => {
    try {
        const { id } = req.params;
        const client = await pool.connect();
        
        const result = await client.query(
            'SELECT "files" FROM articles WHERE "ID" = $1',
            [id]
        );
        client.release();
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Article not found' });
        }
        
        const files = result.rows[0].files;
        if (!files) {
            return res.status(404).json({ success: false, message: 'No files found for this article' });
        }
        
        if (Buffer.isBuffer(files)) {
            // For now, we'll serve the raw binary data
            // In a real application, you might want to:
            // 1. Store file metadata separately to know the file type
            // 2. Use a specific format to identify file boundaries for multiple files
            // 3. Set appropriate headers based on file type
            
            // Set generic binary content type
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', 'attachment; filename="file.bin"');
            res.setHeader('Content-Length', files.length);
            
            res.send(files);
            console.log(`Served binary file for article ${id}, size: ${files.length} bytes`);
        } else {
            res.status(500).json({ success: false, message: 'Invalid file data format' });
        }
        
    } catch (err) {
        console.error('Error serving files:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to serve files',
            ...(process.env.NODE_ENV === 'development' && { error: err.message })
        });
    }
});

// Update without multer; expect file_urls JSON if files are to be set
// Accept JSON or multipart/form-data with only text fields
router.put('/:id', authMiddleware, parseFieldsOnly, articleController.updateArticle); // Fixed route

router.delete('/:id', articleController.deleteArticle);

module.exports = router;