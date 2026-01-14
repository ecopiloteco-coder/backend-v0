const PendingArticle = require('../models/PendingArticle');
const { signedUploadUrlToPublicUrl } = require('../utils/supabase');

const pendingArticleController = {
  /**
   * Get all pending articles (admin only)
   */
  async getAllPendingArticles(req, res) {
    try {
      console.log('GET /api/pending-articles called');
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const requestedLimit = parseInt(req.query.limit, 10) || 10;
      const limit = Math.max(1, Math.min(10, requestedLimit));

      const { data, total, page: currentPage, limit: currentLimit } = await PendingArticle.findAll({ page, limit });

      return res.json({ success: true, data, total, page: currentPage, limit: currentLimit });
    } catch (err) {
      console.error('Error fetching pending articles:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch pending articles',
        ...(process.env.NODE_ENV === 'development' && { error: err.message })
      });
    }
  },

  /**
   * Get count of articles strictly 'En attente' (NULL treated as 'En attente')
   */
  async getPendingCount(req, res) {
    try {
      // Count rows where COALESCE(status, 'En attente') = 'En attente'
      const result = await PendingArticle.countPendingOnly();
      return res.json({ success: true, total: result.total });
    } catch (err) {
      console.error('Error fetching pending count:', err);
      res.status(500).json({ success: false, message: 'Failed to fetch pending count' });
    }
  },

  /**
   * Get pending articles for the authenticated user
   */
  async getUserPendingArticles(req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const requestedLimit = parseInt(req.query.limit, 10) || 10;
      const limit = Math.max(1, Math.min(10, requestedLimit));
      const userId = req.user.id;

      const { data, total, page: currentPage, limit: currentLimit } = await PendingArticle.findByUserId({ 
        userId, 
        page, 
        limit 
      });

      return res.json({ success: true, data, total, page: currentPage, limit: currentLimit });
    } catch (err) {
      console.error('Error fetching user pending articles:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch user pending articles',
        ...(process.env.NODE_ENV === 'development' && { error: err.message })
      });
    }
  },

  /**
   * Get single pending article by ID
   */
  async getPendingArticleById(req, res) {
    try {
      console.log('GET /api/pending-articles/:id called with ID:', req.params.id);
      const { id } = req.params;
      
      // Validate that id is a numeric value to avoid passing strings like "count" to the DB
      if (!/^\d+$/.test(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid article ID'
        });
      }
      
      const numericId = parseInt(id, 10);
      const article = await PendingArticle.findById(numericId);
      
      if (!article) {
        return res.status(404).json({
          success: false,
          message: 'Pending article not found'
        });
      }
      
      // Authorization check: only admin or creator can view
      if (!req.user.is_admin && article.created_by !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view your own pending articles.'
        });
      }
      
      res.json({
        success: true,
        data: article
      });
    } catch (err) {
      console.error('Error fetching pending article:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch pending article',
        ...(process.env.NODE_ENV === 'development' && { error: err.message })
      });
    }
  },

  /**
   * Get single deleted (archived) article by ID
   */
  async getDeletedArticleById(req, res) {
    try {
      console.log('GET /api/pending-articles/deleted/:id called with ID:', req.params.id);
      const { id } = req.params;
      
      const article = await PendingArticle.findDeletedById(id);

      if (!article) {
        return res.status(404).json({
          success: false,
          message: 'Deleted article not found'
        });
      }

      // Authorization check: only admin or creator can view deleted articles
      if (!req.user.is_admin && article.created_by !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      res.json({ success: true, data: article });
    } catch (err) {
      console.error('Error fetching deleted article:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch deleted article',
        ...(process.env.NODE_ENV === 'development' && { error: err.message })
      });
    }
  },

  /**
   * Create new pending article
   */
  async createPendingArticle(req, res) {
    try {
      console.log('=== POST /api/pending-articles START ===');
      console.log('Request body:', req.body);
      console.log('User ID:', req.user.id);
      
      if (!req.body || Object.keys(req.body).length === 0) {
        console.error('req.body is empty or undefined');
        return res.status(400).json({
          success: false,
          message: 'No form data received'
        });
      }
      
      const {
        Date, Niveau_1, Niveau_2__lot, Niveau_3, Niveau_4, Orientation_localisation,
        Niveau_5__article, Niveau_6__detail_article, Unite, Type, Expertise, Fourniture, Cadence,
        Accessoires, Pertes, PU, Prix_Cible, Prix_estime, Prix_consulte, Rabais,
        Commentaires, Indice_de_confiance, fournisseur, article_name, id_niv_6
      } = req.body;
      
      // Process file URLs if provided
      let processedFiles = null;
      if (typeof req.body.file_urls === 'string') {
        try {
          const parsed = JSON.parse(req.body.file_urls);
          if (Array.isArray(parsed)) {
            const toPublicUrl = (typeof signedUploadUrlToPublicUrl === 'function')
              ? signedUploadUrlToPublicUrl
              : (u) => u;
            const normalized = parsed
              .filter(f => f && f.url)
              .map(f => ({
                url: toPublicUrl(f.url),
                filename: f.filename,
                size: f.size
              }));
            if (normalized.length > 0) {
              processedFiles = JSON.stringify(normalized);
              console.log('Using pre-uploaded file URLs, count:', normalized.length);
            }
          }
        } catch (e) {
          console.warn('Invalid file_urls JSON:', e?.message || e);
        }
      }
      
      // Build articleData with all hierarchy fields and id_niv_6 (same pattern as Article.create)
      const articleData = {
        Date, Niveau_1, Niveau_2__lot, Niveau_3, Niveau_4, Orientation_localisation,
        Niveau_5__article, Niveau_6__detail_article, Unite, Type, Expertise, Fourniture, Cadence,
        Accessoires, Pertes, PU, Prix_Cible, Prix_estime, Prix_consulte, Rabais,
        Commentaires, Indice_de_confiance, files: processedFiles, fournisseur,
        article_name, id_niv_6  // Include article_name and id_niv_6 for hierarchy resolution
      };
      
      const result = await PendingArticle.create(articleData, req.user.id);
      
      console.log('=== INSERT SUCCESSFUL ===');
      console.log('Inserted row:', result);
      
      res.status(201).json({
        success: true,
        data: result
      });
      
      console.log('=== POST /api/pending-articles END ===');
    } catch (err) {
      console.error('=== ERROR IN POST /api/pending-articles ===');
      console.error('Error creating pending article:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to create pending article',
        ...(process.env.NODE_ENV === 'development' && { error: err.message })
      });
    }
  },

  /**
   * Update pending article
   */
  async updatePendingArticle(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body || {};
      
      // Extract all hierarchy fields and id_niv_6 (same pattern as create)
      // Note: Don't destructure Date as it shadows the global Date constructor
      const {
        Niveau_1, Niveau_2__lot, Niveau_3, Niveau_4, Orientation_localisation,
        Niveau_5__article, Niveau_6__detail_article, Unite, Type, Expertise, Fourniture, Cadence,
        Accessoires, Pertes, PU, Prix_Cible, Prix_estime, Prix_consulte, Rabais,
        Commentaires, Indice_de_confiance, fournisseur, article_name, id_niv_6
      } = updateData;
      
      // Build updateData with all hierarchy fields and id_niv_6 for hierarchy resolution
      // Date is already included via the spread operator, no need to destructure it
      const enrichedUpdateData = {
        ...updateData,
        Niveau_1, Niveau_2__lot, Niveau_3, Niveau_4, Orientation_localisation,
        Niveau_5__article, Niveau_6__detail_article, Unite, Type, Expertise, Fourniture, Cadence,
        Accessoires, Pertes, PU, Prix_Cible, Prix_estime, Prix_consulte, Rabais,
        Commentaires, Indice_de_confiance, fournisseur, article_name, id_niv_6
      };
      
      if (enrichedUpdateData.Niveau_6__detail_article && !enrichedUpdateData.nom_article) {
        enrichedUpdateData.nom_article = enrichedUpdateData.Niveau_6__detail_article;
      }
      if (enrichedUpdateData.article_name && !enrichedUpdateData.nom_article) {
        enrichedUpdateData.nom_article = enrichedUpdateData.article_name;
      }

      console.log('PUT /api/pending-articles/:id called with ID:', id);
      console.log('Request body:', enrichedUpdateData);

      const status = enrichedUpdateData.status || 'En attente';
      if (status === 'En attente') {
        enrichedUpdateData.reviewed_by = null;
        enrichedUpdateData.reviewed_at = null;
      }

      // Handle file URLs
      let incomingUrls = [];
      if (typeof enrichedUpdateData.file_urls === 'string') {
        try {
          const parsed = JSON.parse(enrichedUpdateData.file_urls);
          if (Array.isArray(parsed)) {
            incomingUrls = parsed
              .filter(f => f && f.url)
              .map(f => ({ url: f.url, filename: f.filename, size: f.size }));
          }
        } catch (e) {
          console.warn('Invalid file_urls JSON on PUT:', e?.message || e);
        }
      }

      if (typeof enrichedUpdateData.file_urls === 'string') {
        enrichedUpdateData.files = JSON.stringify(incomingUrls);
      }

      // Add admin review info if admin
      if (req.user.is_admin) {
        enrichedUpdateData.reviewed_by = req.user.nom_utilisateur || req.user.email || 'Admin';
        enrichedUpdateData.reviewed_at = new Date().toISOString();
      }

      const result = await PendingArticle.update(id, enrichedUpdateData, req.user.id, req.user.is_admin);

      if (result.error) {
        return res.status(result.status).json({ success: false, message: result.error });
      }

      res.json({
        success: true,
        data: result.data,
        message: 'Pending article updated successfully'
      });

    } catch (err) {
      console.error('Error updating pending article:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to update pending article',
        ...(process.env.NODE_ENV === 'development' && { error: err.message })
      });
    }
  },

  /**
   * Approve pending article (admin only)
   */
  async approvePendingArticle(req, res) {
    try {
      const { id } = req.params;
      const adminName = req.user?.nom_utilisateur || req.user?.email || 'admin';
      
      console.log('=== APPROVING ARTICLE ===');
      console.log('Article ID:', id);
      console.log('Admin:', adminName);
      
      const result = await PendingArticle.approve(id, adminName);
      
      if (result.error) {
        return res.status(result.status).json({ success: false, message: result.error });
      }
      
      res.json({ success: true, message: 'Article approved and moved to main table' });
    } catch (err) {
      console.error('=== ERROR APPROVING ARTICLE ===');
      console.error('Error approving article:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to approve article',
        ...(process.env.NODE_ENV === 'development' && { error: err.message })
      });
    }
  },

  /**
   * Reject pending article (admin only)
   */
  async rejectPendingArticle(req, res) {
    try {
      const { id } = req.params;
      const adminName = req.user?.nom_utilisateur || req.user?.email || 'admin';
      
      await PendingArticle.reject(id, adminName);
      
      res.json({ success: true, message: 'Article rejected' });
    } catch (err) {
      console.error('Error rejecting article:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to reject article',
        ...(process.env.NODE_ENV === 'development' && { error: err.message })
      });
    }
  },

  /**
   * Delete pending article (admin only)
   */
  async deletePendingArticle(req, res) {
    try {
      console.log('DELETE /api/pending-articles/:id called with ID:', req.params.id);
      const { id } = req.params;
      const adminName = req.user?.nom_utilisateur || req.user?.email || 'admin';
      
      const result = await PendingArticle.delete(id, req.user.id, req.user.is_admin, adminName);
      
      if (result.error) {
        return res.status(result.status).json({ success: false, message: result.error });
      }
      
      return res.json({
        success: true,
        message: 'Pending article archived to articles_supprime and deleted',
        data: result.data
      });
    } catch (err) {
      console.error('Error deleting pending article:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to delete pending article',
        ...(process.env.NODE_ENV === 'development' && { error: err.message })
      });
    }
  },

  /**
   * Debug route for testing
   */
  async debugRoute(req, res) {
    console.log('=== DEBUG ROUTE ===');
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    console.log('Body type:', typeof req.body);
    console.log('Body keys:', req.body ? Object.keys(req.body) : 'no body');
    console.log('Files:', req.files);
    
    res.json({
      message: 'Debug route - no middleware',
      hasBody: !!req.body,
      bodyType: typeof req.body,
      bodyKeys: req.body ? Object.keys(req.body) : [],
      hasFiles: !!req.files,
      contentType: req.get('Content-Type')
    });
  },

  /**
   * Test route
   */
  async testRoute(req, res) {
    res.json({ message: 'Pending articles router is working!' });
  },

  /**
   * Test POST route
   */
  async testPostRoute(req, res) {
    console.log('=== TEST POST ROUTE ===');
    console.log('Request method:', req.method);
    console.log('Request headers:', req.headers);
    console.log('Request body:', req.body);
    console.log('Request body type:', typeof req.body);
    console.log('Content-Type:', req.get('Content-Type'));
    res.json({
      message: 'Test POST route working',
      body: req.body,
      bodyType: typeof req.body,
      headers: req.headers,
      contentType: req.get('Content-Type')
    });
  },

  /**
   * Test form HTML
   */
  async testFormHtml(req, res) {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>File Upload Test</title>
    </head>
    <body>
        <h1>File Upload Test</h1>
        
        <h2>Test 1: Debug Route (No Multer)</h2>
        <form action="/api/pending-articles/debug" method="post" enctype="multipart/form-data">
            <input type="text" name="testField" value="test value" placeholder="Test field">
            <input type="file" name="files" multiple>
            <button type="submit">Submit to Debug</button>
        </form>
        
        <h2>Test 2: Debug Multer Route</h2>
        <form action="/api/pending-articles/debug-multer" method="post" enctype="multipart/form-data">
            <input type="text" name="testField" value="test value" placeholder="Test field">
            <input type="file" name="files" multiple>
            <button type="submit">Submit to Debug Multer</button>
        </form>
        
        <h2>Test 3: Simple Upload Test</h2>
        <form action="/api/pending-articles/test-simple" method="post" enctype="multipart/form-data">
            <input type="text" name="testField" value="test value" placeholder="Test field">
            <input type="file" name="files" multiple>
            <button type="submit">Submit to Simple Test</button>
        </form>
        
        <script>
            document.querySelectorAll('form').forEach(form => {
                form.addEventListener('submit', function(e) {
                    console.log('Submitting form to:', this.action);
                    const formData = new FormData(this);
                    console.log('Form data entries:');
                    for (let [key, value] of formData.entries()) {
                        if (value instanceof File) {
                            console.log(key + ': [File] ' + value.name + ' (' + value.size + ' bytes)');
                        } else {
                            console.log(key + ': ' + value);
                        }
                    }
                });
            });
        </script>
    </body>
    </html>
    `;
    res.send(html);
  }
};

module.exports = pendingArticleController;
