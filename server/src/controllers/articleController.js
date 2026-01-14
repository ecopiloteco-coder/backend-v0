const Article = require('../models/Article');
const { normalize } = require('../utils/normalize');
const pool = require('../../config/db');
const { uploadBufferToBucket, signedUploadUrlToPublicUrl } = require('../utils/supabase');
const NiveauService = require('../services/NiveauService');
function isValidFilter(value) {
  return value !== undefined && value !== null && value !== '' && value !== 'undefined' && value !== 'null';
}

const articleController = {

  // Get search suggestions
  async getSuggestions(req, res) {
    try {
      const { q, limit = 8 } = req.query;

      if (!q || q.trim() === '') {
        return res.json({
          success: true,
          suggestions: []
        });
      }

      const suggestions = await Article.searchSuggestions(q.trim(), parseInt(limit));

      res.json({
        success: true,
        suggestions: suggestions.map(s => ({
          text: s.text,
          type: s.type,
          count: parseInt(s.count)
        }))
      });
    } catch (err) {
      console.error('Error in getSuggestions:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch suggestions',
        error: err.message
      });
    }
  },

  // Get all articles
  async getAllArticles(req, res) {
    try {
      // Validate query parameters
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const { searchTerm = '', expertise = '', date = '', niveau1 = '', niveau2 = '' } = req.query;

      console.log('=== GET ALL ARTICLES DEBUG ===');
      console.log('Query params:', { page, limit, searchTerm, expertise, date, niveau1, niveau2 });

      if (page < 1 || limit < 1) {
        return res.status(400).json({
          success: false,
          message: 'Invalid page or limit parameters',
        });
      }

      // Validate date format if provided
      if (date && date.trim()) {
        console.log('Processing date filter:', date);
        try {
          // Check if it's a valid date string
          const testDate = new Date(date);
          if (isNaN(testDate.getTime())) {
            console.log('Invalid date format detected:', date);
            return res.status(400).json({
              success: false,
              message: 'Invalid date format. Please use YYYY-MM-DD format',
            });
          }

          // Check if the date is reasonable (not too far in past/future)
          const currentYear = new Date().getFullYear();
          const dateYear = testDate.getFullYear();
          if (dateYear < 1900 || dateYear > currentYear + 10) {
            console.log('Date out of reasonable range:', dateYear);
            return res.status(400).json({
              success: false,
              message: 'Date must be between 1900 and ' + (currentYear + 10),
            });
          }
          console.log('Date validation passed:', date);
        } catch (dateError) {
          console.log('Date validation error:', dateError);
          return res.status(400).json({
            success: false,
            message: 'Invalid date format. Please use YYYY-MM-DD format',
          });
        }
      }

      // Fetch paginated and filtered articles
      const { data, count, totalCount, totalPages, currentPage } = await Article.findAll({
        page,
        limit,
        searchTerm,
        expertise,
        date,
        niveau1,
        niveau2,
      });

      console.log('Articles fetched successfully:', { count, totalCount, totalPages, currentPage });

      res.json({
        success: true,
        data,
        count,
        totalCount,
        totalPages,
        currentPage,
      });
    } catch (err) {
      console.error('Error in getAllArticles:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch articles',
        error: err.message,
      });
    }
  },

  // Get article by ID
  async getArticleById(req, res) {
    try {
      const { id } = req.params;
      console.log('Fetching article with ID:', id);

      // Validate ID is a number
      if (isNaN(parseInt(id))) {
        return res.status(400).json({
          success: false,
          message: 'Invalid article ID',
        });
      }

      const article = await Article.findById(id);
      console.log('Article found:', article);

      if (!article) {
        return res.status(404).json({
          success: false,
          message: 'Article not found',
        });
      }

      res.json({
        success: true,
        data: article,
      });
    } catch (err) {
      console.error('Error in getArticleById:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch article',
        error: err.message,
      });
    }
  },

  async createArticle(req, res) {
    try {
      console.log('=== CREATE ARTICLE REQUEST ===');
      console.log('Request body:', req.body);
      console.log('Request headers:', req.headers);
      console.log('Request files:', req.files);

      const userId = req.user?.id;
      if (!userId) {
        console.log('Unauthorized: user ID missing');
        return res.status(401).json({
          success: false,
          message: 'Unauthorized: user ID missing',
        });
      }

      const {
        article_name,
        Niveau_6__detail_article,
        Unite,
        Type,
        Date,
        Expertise,
        // Note: Type_Prestation here should be 'entreprise' | 'fournisseur' if provided
        Type_Prestation,
        PU,
        Prix_Cible,
        Prix_estime,
        Prix_consulte,
        fournisseur, // Extract fournisseur ID
      } = req.body;

      const fallbackName = (typeof Niveau_6__detail_article === 'string' ? Niveau_6__detail_article : null);
      const rawArticleName = (typeof article_name === 'string' ? article_name : fallbackName);
      const finalArticleName = rawArticleName ? rawArticleName.trim() : '';

      if (!finalArticleName || !Unite || !Type || !Date || !Expertise || !PU) {
        console.log('Missing required fields:', { finalArticleName, Unite, Type, Date, Expertise, PU });
        return res.status(400).json({
          success: false,
          message: 'article_name (or Niveau_6__detail_article), Unite, Type, Date, Expertise, and PU are required',
        });
      }

      // Check if article exists
      const checkResult = await Article.checkArticleExists({
        name: finalArticleName,
        datePrix: Date,
        expertise: Expertise,
        fournisseurId: fournisseur ? parseInt(fournisseur) : null,
      });

      console.log('Check exists result:', checkResult);

      if (checkResult.exists) {
        // Determine submitted origin from which price field is provided (> 0)
        const submittedOrigin = (() => {
          const pc = parseFloat((Prix_consulte ?? '0') || '0');
          const pe = parseFloat((Prix_estime ?? '0') || '0');
          const pC = parseFloat((Prix_Cible ?? '0') || '0');
          if (pc > 0) return 'consulte';
          if (pe > 0) return 'estime';
          if (pC > 0) return 'cible';
          return null;
        })();

        // Check for fournisseur mismatch first
        if (fournisseur && checkResult.fournisseur_id &&
          parseInt(fournisseur) !== checkResult.fournisseur_id) {
          console.log('Fournisseur mismatch:', {
            existing: checkResult.fournisseur_id,
            submitted: parseInt(fournisseur),
            existing_type: checkResult.fournisseur_type
          });
          return res.status(409).json({
            success: false,
            message: `Article already exists with a different supplier (${checkResult.fournisseur_type}). Please verify the selected supplier.`,
          });
        }

        // Check for origin mismatch only if no fournisseur conflict
        if (submittedOrigin && checkResult.origin !== submittedOrigin) {
          console.log('Origin mismatch:', { existing: checkResult.origin, submitted: submittedOrigin });
          return res.status(409).json({
            success: false,
            message: `Article already exists with a different origin (${checkResult.origin}). Please verify the selected origin.`,
          });
        }

        console.log('Article already exists with same criteria');
        return res.status(409).json({
          success: false,
          message: 'Article with these criteria already exists in the database (same name, date, expertise, and supplier).',
        });
      }

      // No server-side buffer upload; prefer pre-uploaded URLs provided by client
      let processedFiles = null; // store Supabase URLs as JSON string
      if (!processedFiles && typeof req.body.file_urls === 'string') {
        try {
          const parsed = JSON.parse(req.body.file_urls);
          if (Array.isArray(parsed)) {
            const toPublicUrl = (typeof signedUploadUrlToPublicUrl === 'function')
              ? signedUploadUrlToPublicUrl
              : (u) => u;
            const normalized = parsed
              .filter(f => f && f.url)
              .map(f => ({ url: toPublicUrl(f.url), filename: f.filename, size: f.size }));
            if (normalized.length > 0) {
              processedFiles = JSON.stringify(normalized);
            }
          }
        } catch (e) {
          console.warn('Invalid file_urls JSON:', e?.message || e);
        }
      }

      // Prepare article data - trust incoming price fields
      const articleData = {
        ...req.body,
        article_name: finalArticleName,
        userId,
        PU: parseFloat(PU || '0').toFixed(2),
        Prix_Cible: (typeof Prix_Cible === 'string' ? parseFloat(Prix_Cible || '0') : Number(Prix_Cible || 0)).toFixed(2),
        Prix_estime: (typeof Prix_estime === 'string' ? parseFloat(Prix_estime || '0') : Number(Prix_estime || 0)).toFixed(2),
        Prix_consulte: (typeof Prix_consulte === 'string' ? parseFloat(Prix_consulte || '0') : Number(Prix_consulte || 0)).toFixed(2),
        files: processedFiles,
      };

      const article = await Article.create(articleData);

      console.log('Article created successfully:', article);

      res.status(201).json({
        success: true,
        message: 'Article created successfully',
        data: article,
      });
    } catch (err) {
      console.error('Error in createArticle:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to create article',
        error: err.message,
      });
    }
  },

  // Update article
  async updateArticle(req, res) {
    try {
      const { id } = req.params;
      console.log("=== UPDATE ARTICLE REQUEST ===");
      console.log("Article ID:", id);
      console.log("Content-Type:", req.headers['content-type']);
      console.log("Request body:", req.body);
      console.log("Request files:", req.files);

      let updateData = {};

      // ✅ Handle different content types
      if (req.headers['content-type']?.includes('application/json')) {
        // JSON request
        updateData = req.body || {};
        console.log("Processing JSON request");
      } else if (req.headers['content-type']?.includes('multipart/form-data')) {
        // FormData request - requires multer middleware
        if (req.body === undefined) {
          return res.status(400).json({
            success: false,
            message: "FormData not properly parsed. Make sure multer middleware is configured.",
          });
        }
        updateData = req.body || {};
        console.log("Processing FormData request");

        // File uploads handled below with Supabase and merged with file_urls
      } else {
        // Other content types
        updateData = req.body || {};
      }

      console.log("Raw updateData:", updateData);
      console.log("UpdateData keys:", Object.keys(updateData));
      console.log("UpdateData type:", typeof updateData);

      // ✅ Validate updateData exists and is an object
      if (!updateData || typeof updateData !== 'object') {
        return res.status(400).json({
          success: false,
          message: "Invalid request data. Expected object but received: " + typeof updateData,
        });
      }

      // ✅ Define valid column names based on your database schema
      const validColumns = [
        'Date', 'Niveau_1', 'Niveau_2__lot', 'Niveau_3', 'Niveau_4',
        'Orientation_localisation', 'Niveau_5__article', 'Niveau_6__detail_article',
        'nom_article', 'id_niveau_6',
        'Unite', 'Type', 'Expertise', 'Fourniture', 'Cadence', 'Accessoires',
        'Pertes', 'PU', 'Prix_Cible', 'Prix_estime', 'Prix_consulte', 'Rabais',
        'Commentaires', 'User',
        'Indice_de_confiance', 'files',
        // Allow updating supplier link
        'fournisseur',
        // Allow updating article designation
        'designation_article'
      ];

      // Build files JSON (merge file_urls + new uploads)
      let incomingUrls = [];
      if (typeof updateData.file_urls === 'string') {
        try {
          const parsed = JSON.parse(updateData.file_urls);
          if (Array.isArray(parsed)) {
            incomingUrls = parsed.filter(f => f && f.url).map(f => ({ url: f.url, filename: f.filename, size: f.size }));
          }
        } catch (e) {
          console.warn('Invalid file_urls JSON on article PUT:', e?.message || e);
        }
      }

      const hasNewFiles = req.files && req.files.files && Array.isArray(req.files.files) && req.files.files.length > 0;
      let mergedFilesJson = null;
      if (hasNewFiles) {
        const uploads = [];
        for (const f of req.files.files) {
          uploads.push(uploadBufferToBucket(f.buffer, f.originalname, { bucket: 'upload', prefix: 'articles', contentType: f.mimetype || 'application/octet-stream' }));
        }
        const results = await Promise.allSettled(uploads);
        const successfulUploads = [];
        results.forEach((r, idx) => {
          if (r.status === 'fulfilled') {
            successfulUploads.push({ url: r.value.publicUrl, filename: req.files.files[idx]?.originalname, size: req.files.files[idx]?.size });
          } else {
            console.warn('Supabase upload failed for file', req.files.files[idx]?.originalname, r.reason?.message || r.reason);
          }
        });
        const merged = [...incomingUrls, ...successfulUploads];
        mergedFilesJson = JSON.stringify(merged);
      } else if (typeof updateData.file_urls === 'string') {
        mergedFilesJson = JSON.stringify(incomingUrls);
      }

      // ✅ Filter out invalid values, file array keys, and non-existent columns
      const cleanUpdateData = {};
      Object.keys(updateData).forEach(key => {
        const value = updateData[key];

        console.log(`Processing field: ${key} = ${value} (type: ${typeof value})`);

        // Skip file array keys (files[0], files[1], etc.)
        if (key.startsWith('files[')) {
          console.log('Skipping file array key:', key);
          return;
        }

        // Skip computed fields that don't exist in database
        if (key === 'PU_Result') {
          console.log('Skipping computed field:', key);
          return;
        }

        // Only include valid columns that exist in the database
        if (!validColumns.includes(key)) {
          console.log('Skipping non-existent column:', key);
          return;
        }

        // files are handled via mergedFilesJson; skip raw 'files' from body
        if (key === 'files') return;

        // Only include valid values
        if (value !== undefined && value !== null && value !== '' && value !== 'undefined') {
          cleanUpdateData[key] = value;
          console.log(`Added to clean data: ${key} = ${value}`);
        } else {
          console.log(`Skipping invalid value for ${key}:`, value);
        }
      });

      console.log("Cleaned update data:", cleanUpdateData);
      console.log("Clean data keys:", Object.keys(cleanUpdateData));

      // Check if there's any data to update
      if (Object.keys(cleanUpdateData).length === 0) {
        return res.status(400).json({
          success: false,
          message: "No valid update data provided. Received fields: " + Object.keys(updateData).join(', '),
          debug: {
            originalKeys: Object.keys(updateData),
            contentType: req.headers['content-type'],
            bodyType: typeof updateData
          }
        });
      }

      // Inject mergedFilesJson if applicable
      if (mergedFilesJson !== null) {
        cleanUpdateData.files = mergedFilesJson;
      }

      // Check if article exists
      const existingArticle = await Article.findById(id);
      if (!existingArticle) {
        return res.status(404).json({
          success: false,
          message: "Article not found",
        });
      }

      // If no files change provided, preserve existing files
      if (!('files' in cleanUpdateData) && existingArticle.files) {
        console.log('Preserving existing files:', existingArticle.files);
        cleanUpdateData.files = existingArticle.files;
      }

      console.log("About to update article with:", cleanUpdateData);

      // Update the article
      const updatedArticle = await Article.update(id, cleanUpdateData);

      // Mirror changes to pending_articles if this article was approved from a pending item
      try {
        // Only propagate columns that exist on pending_articles
        const pendingAllowed = [
          'Date', 'Unite', 'Type', 'Expertise', 'Fourniture',
          'Cadence', 'Accessoires', 'Pertes', 'PU', 'Prix_Cible', 'Prix_estime', 'Prix_consulte', 'Rabais',
          'Origine_Prestation', 'Commentaires', 'Type_Prestation', 'Indice_de_confiance', 'files',
          'article_name', 'id_niveau_6', 'fournisseur'
        ];
        const pendingUpdateData = {};
        for (const k of Object.keys(cleanUpdateData)) {
          if (pendingAllowed.includes(k)) pendingUpdateData[k] = cleanUpdateData[k];
        }
        if (Object.keys(pendingUpdateData).length > 0) {
          const setFragments = Object.keys(pendingUpdateData).map((col, idx) => `"${col}" = $${idx + 2}`);
          const values = [id, ...Object.keys(pendingUpdateData).map(k => pendingUpdateData[k])];
          const setClause = setFragments.join(', ') + ', "updated_at" = CURRENT_TIMESTAMP';
          await pool.query(
            `UPDATE pending_articles SET ${setClause} WHERE "approved_article_id" = $1`,
            values
          );
        }
      } catch (propErr) {
        // Do not block the main update flow if pending mirror fails
        console.warn('Warning: failed to mirror update to pending_articles:', propErr.message);
      }

      res.json({
        success: true,
        message: "Article updated successfully",
        data: updatedArticle,
      });
    } catch (err) {
      console.error("=== UPDATE ARTICLE ERROR ===", err);
      res.status(500).json({
        success: false,
        message: "Failed to update article",
        error: err.message,
      });
    }
  },

  async checkArticleExists({ name, datePrix, expertise }) {
    const client = await pool.connect();
    try {
      console.log('=== CHECK ARTICLE EXISTS ===');
      console.log('Parameters:', { name, datePrix, expertise });

      if (!name || !datePrix || !expertise) {
        throw new Error('Missing required fields: name, datePrix, and expertise are required');
      }

      const testDate = new Date(datePrix);
      if (isNaN(testDate.getTime())) {
        throw new Error('Invalid date format. Please use YYYY-MM-DD format');
      }

      // Enhanced query to get all relevant fields for debugging
      const query = `
        SELECT "ID", "PU", "Prix_consulte", "Prix_estime", "Prix_Cible", "Type_Prestation",
               "nom_article" AS "article_name", "Date", "Expertise"
        FROM articles
        WHERE LOWER("nom_article") = LOWER($1)
        AND "Date" = $2
        AND LOWER("Expertise") = LOWER($3)
      `;
      const values = [name, datePrix, expertise];
      const result = await client.query(query, values);

      console.log('=== DETAILED QUERY RESULT ===');
      console.log('Number of matching records:', result.rows.length);

      if (result.rows.length > 0) {
        result.rows.forEach((row, index) => {
          console.log(`Record ${index + 1}:`, {
            ID: row.ID,
            PU: `"${row.PU}" (type: ${typeof row.PU})`,
            Prix_consulte: `"${row.Prix_consulte}" (type: ${typeof row.Prix_consulte})`,
            Prix_estime: `"${row.Prix_estime}" (type: ${typeof row.Prix_estime})`,
            Prix_Cible: `"${row.Prix_Cible}" (type: ${typeof row.Prix_Cible})`,
            Type_Prestation: `"${row.Type_Prestation}" (type: ${typeof row.Type_Prestation})`,
          });
        });
      }

      if (result.rows.length > 0) {
        const article = result.rows[0];
        let origin = null;

        console.log('=== ORIGIN DETECTION PROCESS ===');

        // First, check if Type_Prestation is set
        console.log('Checking Type_Prestation:', `"${article.Type_Prestation}"`);
        if (article.Type_Prestation && article.Type_Prestation.trim() !== '') {
          origin = article.Type_Prestation.toLowerCase();
          console.log('Origin determined from Type_Prestation:', origin);
        } else {
          console.log('Type_Prestation is empty, falling back to price-based detection');

          // Fallback to price-based detection with enhanced logging
          const puRaw = article.PU;
          const prixConsulteRaw = article.Prix_consulte;
          const prixEstimeRaw = article.Prix_estime;
          const prixCibleRaw = article.Prix_Cible;

          console.log('Raw price values:', {
            puRaw: `"${puRaw}"`,
            prixConsulteRaw: `"${prixConsulteRaw}"`,
            prixEstimeRaw: `"${prixEstimeRaw}"`,
            prixCibleRaw: `"${prixCibleRaw}"`
          });

          const pu = parseFloat(puRaw || '0');
          const prixConsulte = parseFloat(prixConsulteRaw || '0');
          const prixEstime = parseFloat(prixEstimeRaw || '0');
          const prixCible = parseFloat(prixCibleRaw || '0');

          console.log('Parsed price values:', { pu, prixConsulte, prixEstime, prixCible });
          console.log('Price checks:');
          console.log('  prixConsulte > 0:', prixConsulte > 0);
          console.log('  prixEstime > 0:', prixEstime > 0);
          console.log('  prixCible > 0:', prixCible > 0);
          console.log('  pu > 0:', pu > 0);

          if (prixConsulte > 0) {
            origin = 'consulte';
            console.log('Origin set to consulte (prixConsulte > 0)');
          } else if (prixEstime > 0) {
            origin = 'estime';
            console.log('Origin set to estime (prixEstime > 0)');
          } else if (prixCible > 0) {
            origin = 'cible';
            console.log('Origin set to cible (prixCible > 0)');
          } else if (pu > 0) {
            origin = 'cible';
            console.log('Origin set to cible (pu > 0, default fallback)');
          }
        }

        // If we still can't determine origin
        if (!origin) {
          console.warn('Could not determine origin for existing article:', article);
          console.log('=== DATA QUALITY ISSUE ===');
          console.log('This suggests the article has no meaningful price data or Type_Prestation');
          console.log('Consider checking the data integrity for this record');

          // For now, let's assume 'cible' as default when we can't determine
          origin = 'cible';
          console.log('Defaulting origin to cible');
        }

        const finalPu = parseFloat(article.PU || '0');
        console.log('=== FINAL RESULT ===');
        console.log('Final origin:', origin);
        console.log('Final PU:', finalPu);

        return {
          exists: true,
          origin: origin,
          pu: finalPu.toString(),
        };
      }

      console.log('No matching records found');
      return { exists: false };
    } catch (error) {
      console.error('Error in checkArticleExists:', error);
      throw error;
    } finally {
      client.release();
    }
  },

  // Delete article
  async deleteArticle(req, res) {
    try {
      const { id } = req.params;
      const article = await Article.delete(id);

      if (!article) {
        return res.status(404).json({
          success: false,
          message: 'Article not found'
        });
      }

      res.json({
        success: true,
        message: 'Article deleted successfully (archived into articles_supprime)',
        data: article
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        message: 'Failed to delete article',
        error: err.message
      });
    }
  }, async searchDistinctWithFilter(column, searchTerm = '', filters = {}) {
    const conditions = [`"${column}" IS NOT NULL`, `"${column}" != ''`];
    const values = [];
    let idx = 1;

    // Search term (partial match, accent-insensitive)
    if (searchTerm.trim() !== '') {
      conditions.push(
        `unaccent(TRIM(LOWER("${column}"))) LIKE unaccent(TRIM(LOWER($${idx})))`
      );
      values.push(`%${searchTerm.trim()}%`);
      idx++;
    }

    // Filters (exact match, accent-insensitive)
    for (const [filterColumn, filterValue] of Object.entries(filters)) {
      if (filterValue && filterValue.toString().trim() !== '') {
        conditions.push(
          `unaccent(TRIM(LOWER("${filterColumn}"))) = unaccent(TRIM(LOWER($${idx})))`
        );
        values.push(filterValue.toString().trim());
        idx++;
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
      SELECT DISTINCT "${column}"
      FROM articles
      ${whereClause}
      ORDER BY "${column}"
    `;

    console.log('Generated query:', query);
    console.log('Parameter values:', values.map((v, i) => `$${i + 1}: "${v}"`));

    try {
      const { rows } = await db.query(query, values);
      console.log('Query results:', JSON.stringify(rows, null, 2));
      return rows.map(r => r[column]);
    } catch (err) {
      console.error('Query execution error:', err.message, err.stack);
      throw err;
    }
  },

  // Simple distinct search
  async searchDistinct(column, searchTerm = '') {
    const conditions = [`"${column}" IS NOT NULL`, `"${column}" != ''`];
    const values = [];
    let idx = 1;

    if (searchTerm.trim() !== '') {
      conditions.push(
        `unaccent(TRIM(LOWER("${column}"))) LIKE unaccent(TRIM(LOWER($${idx})))`
      );
      values.push(`%${searchTerm.trim()}%`);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
      SELECT DISTINCT "${column}"
      FROM articles
      ${whereClause}
      ORDER BY "${column}"
      LIMIT 10
    `;

    try {
      const { rows } = await db.query(query, values);
      return rows.map(r => r[column]);
    } catch (err) {
      console.error('Query execution error in searchDistinct:', err.message);
      throw err;
    }
  },

  // Niveau 1 search
  async searchNiveau1(req, res) {
    try {
      const { q = '' } = req.query;
      const client = await pool.connect();
      try {
        // Search niveau_1 table directly instead of through articles table
        const results = await NiveauService.searchHierarchyTableDirect(client, 'niveau1', q, {});
        res.json({ success: true, data: results });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Error in searchNiveau1:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  },
  // Niveau 2 search with unaccent (like Niveau 3)
  // Niveau 2 search with unaccent like Niveau 3
  async searchNiveau2(req, res) {
    try {
      const { q = '', niveau1 } = req.query;

      if (!niveau1 || niveau1.trim() === '') {
        return res.status(400).json({ success: false, message: 'niveau1 is required to filter Niveau 2' });
      }

      const client = await pool.connect();
      try {
        const searchTerm = q.toString().trim();
        const parentFilters = { 'niveau1': niveau1.trim() };

        // Search niveau_2 table directly filtered by niveau1
        const results = await NiveauService.searchHierarchyTableDirect(client, 'niveau2', searchTerm, parentFilters);

        res.json({ success: true, data: results || [] });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Error in searchNiveau2:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
  ,

  // Get all Niveau 2 options, optionally filtered by Niveau 1
  async getNiveau2Options(req, res) {
    try {
      // Return ALL lots directly from niveau_2 table,
      // not only those present in articles
      const client = await pool.connect();
      try {
        // Detect available columns on niveau_2 to avoid errors if one doesn't exist
        const colsRes = await client.query(
          `SELECT column_name 
           FROM information_schema.columns 
           WHERE table_name = 'niveau_2' 
             AND column_name IN ('niveau_2', 'Niveau_2__lot')`
        );
        const available = new Set((colsRes.rows || []).map(r => r.column_name));
        let options = [];

        if (available.has('niveau_2') && available.has('Niveau_2__lot')) {
          const unionRes = await client.query(`
            SELECT DISTINCT TRIM(niveau_2) AS lot FROM niveau_2 WHERE niveau_2 IS NOT NULL AND TRIM(niveau_2) <> ''
            UNION
            SELECT DISTINCT TRIM("Niveau_2__lot") AS lot FROM niveau_2 WHERE "Niveau_2__lot" IS NOT NULL AND TRIM("Niveau_2__lot") <> ''
            ORDER BY lot
          `);
          options = (unionRes.rows || []).map(r => r.lot);
        } else if (available.has('niveau_2')) {
          const res1 = await client.query(`
            SELECT DISTINCT TRIM(niveau_2) AS lot 
            FROM niveau_2 
            WHERE niveau_2 IS NOT NULL AND TRIM(niveau_2) <> ''
            ORDER BY lot
          `);
          options = (res1.rows || []).map(r => r.lot);
        } else if (available.has('Niveau_2__lot')) {
          const res2 = await client.query(`
            SELECT DISTINCT TRIM("Niveau_2__lot") AS lot 
            FROM niveau_2 
            WHERE "Niveau_2__lot" IS NOT NULL AND TRIM("Niveau_2__lot") <> ''
            ORDER BY lot
          `);
          options = (res2.rows || []).map(r => r.lot);
        } else {
          options = [];
        }

        res.json({ success: true, data: options });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Error in getNiveau2Options:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // Niveau 3 search
  async searchNiveau3(req, res) {
    try {
      const source = Object.keys(req.query).length > 0 ? req.query : req.body;
      let { q = '', niveau1, niveau2, Niveau_2__lot } = source;

      q = q?.toString().trim() || '';
      niveau1 = niveau1?.toString().trim() || '';
      niveau2 = niveau2?.toString().trim() || '';
      Niveau_2__lot = Niveau_2__lot?.toString().trim() || '';
      const effectiveNiveau2 = niveau2 || Niveau_2__lot;

      if (!q && !niveau1 && !effectiveNiveau2) {
        return res.status(400).json({
          success: false,
          message: 'At least one search parameter (q, niveau1, or niveau2) is required.',
        });
      }

      const client = await pool.connect();
      try {
        const parentFilters = {};
        if (niveau1) parentFilters['niveau1'] = niveau1;
        if (effectiveNiveau2) parentFilters['niveau2'] = effectiveNiveau2;

        // Search niveau_3 table directly
        const results = await NiveauService.searchHierarchyTableDirect(client, 'niveau3', q, parentFilters);

        res.json({
          success: true,
          data: results || [],
          debug: {
            searchColumn: 'Niveau_3',
            searchTerm: q,
            appliedFilters: parentFilters,
            filterCount: Object.keys(parentFilters).length,
            resultCount: results.length,
            rawParams: source,
            dataSource: Object.keys(req.query).length > 0 ? 'query' : 'body',
          },
        });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Error in searchNiveau3:', err);
      res.status(500).json({
        success: false,
        message: err.message,
        debug: { queryParams: req.query, body: req.body, error: err.message },
      });
    }
  }

  , async searchNiveau4(req, res) {
    try {
      const source = Object.keys(req.query).length > 0 ? req.query : req.body;
      let { q = '', niveau1, niveau2, niveau3 } = source;

      const normalizeValue = (val) => {
        if (val === null || val === undefined) return undefined;
        const str = val.toString().trim();
        if (str === '' || str.toLowerCase() === 'undefined' || str.toLowerCase() === 'null') return undefined;
        return str; // keep special chars like & é
      };

      niveau1 = normalizeValue(niveau1);
      niveau2 = normalizeValue(niveau2);
      niveau3 = normalizeValue(niveau3);

      console.log('=== SEARCH NIVEAU 4 ===');
      console.log('Normalized params:', { q, niveau1, niveau2, niveau3 });

      // If no niveau1, niveau2, and niveau3, return early
      if (!niveau1 && !niveau2 && !niveau3) {
        console.log('No niveau1, niveau2, or niveau3 provided.');
        return res.json({
          success: true,
          data: [],
          debug: {
            message: 'No filters provided for niveau1, niveau2, or niveau3.',
            searchColumn: 'Niveau_4',
            searchTerm: q,
            appliedFilters: {},
            filterCount: 0,
            resultCount: 0,
          },
        });
      }

      const client = await pool.connect();
      try {
        // Create parent filters using levelKey format
        const parentFilters = {};
        if (niveau1) parentFilters['niveau1'] = niveau1;
        if (niveau2) parentFilters['niveau2'] = niveau2;
        if (niveau3) parentFilters['niveau3'] = niveau3;

        console.log('Parent filters:', parentFilters);

        // Search niveau_4 table directly
        const results = await NiveauService.searchHierarchyTableDirect(client, 'niveau4', q, parentFilters);

        res.json({
          success: true,
          data: results || [],
          debug: {
            searchColumn: 'Niveau_4',
            searchTerm: q,
            appliedFilters: parentFilters,
            filterCount: Object.keys(parentFilters).length,
            resultCount: results ? results.length : 0,
            rawParams: source,
            dataSource: Object.keys(req.query).length > 0 ? 'query' : 'body',
          },
        });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Error in searchNiveau4:', err);
      res.status(500).json({
        success: false,
        message: err.message,
        debug: {
          function: 'searchNiveau4',
          queryParams: req.query || {},
          body: req.body || {},
          error: err.message,
        },
      });
    }
  }
  , async searchNiveau5(req, res) {
    try {
      const source = Object.keys(req.query).length > 0 ? req.query : req.body;
      let { q = '', niveau1, niveau2, niveau3, niveau4 } = source;

      q = q?.toString().trim() || '';
      niveau1 = niveau1?.toString().trim() || '';
      niveau2 = niveau2?.toString().trim() || '';
      niveau3 = niveau3?.toString().trim() || '';
      niveau4 = niveau4?.toString().trim() || '';

      if (!q && !niveau1 && !niveau2 && !niveau3 && !niveau4) {
        return res.status(400).json({
          success: false,
          message: 'At least one search parameter (q, niveau1, niveau2, niveau3, or niveau4) is required.',
        });
      }

      const client = await pool.connect();
      try {
        const parentFilters = {};
        if (niveau1) parentFilters['niveau1'] = niveau1;
        if (niveau2) parentFilters['niveau2'] = niveau2;
        if (niveau3) parentFilters['niveau3'] = niveau3;
        if (niveau4) parentFilters['niveau4'] = niveau4;

        // Search niveau_5 table directly
        const results = await NiveauService.searchHierarchyTableDirect(client, 'niveau5', q, parentFilters);

        res.json({
          success: true,
          data: results || [],
          debug: {
            searchColumn: 'Orientation_localisation',
            searchTerm: q,
            appliedFilters: parentFilters,
            filterCount: Object.keys(parentFilters).length,
            resultCount: results.length,
            rawParams: source,
            dataSource: Object.keys(req.query).length > 0 ? 'query' : 'body',
          },
        });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Error in searchNiveau5:', err);
      res.status(500).json({
        success: false,
        message: err.message,
        debug: { function: 'searchNiveau5', queryParams: req.query, body: req.body, error: err.message },
      });
    }
  }
  ,

  // Search niveau 6 (niveau_6 table) with hierarchy filtering
  async searchNiveau6(req, res) {
    try {
      const source = Object.keys(req.query).length > 0 ? req.query : req.body;
      let { q = '', niveau1, niveau2, niveau3, niveau4, niveau5 } = source;

      q = q?.toString().trim() || '';
      niveau1 = niveau1?.toString().trim() || '';
      niveau2 = niveau2?.toString().trim() || '';
      niveau3 = niveau3?.toString().trim() || '';
      niveau4 = niveau4?.toString().trim() || '';
      niveau5 = niveau5?.toString().trim() || '';

      console.log('=== SEARCH NIVEAU 6 (DIRECT TABLE) ===');
      console.log('Params:', { q, niveau1, niveau2, niveau3, niveau4, niveau5 });

      const client = await pool.connect();
      try {
        const parentFilters = {};
        if (niveau1) parentFilters['niveau1'] = niveau1;
        if (niveau2) parentFilters['niveau2'] = niveau2;
        if (niveau3) parentFilters['niveau3'] = niveau3;
        if (niveau4) parentFilters['niveau4'] = niveau4;
        if (niveau5) parentFilters['niveau5'] = niveau5;

        console.log('Parent filters:', parentFilters);

        // Search niveau_6 table directly
        const results = await NiveauService.searchHierarchyTableDirect(client, 'niveau6', q, parentFilters);

        console.log('Results:', results.length);

        res.json({
          success: true,
          data: results || [],
          debug: {
            searchColumn: 'niveau_6',
            searchTerm: q,
            appliedFilters: parentFilters,
            filterCount: Object.keys(parentFilters).length,
            resultCount: results ? results.length : 0,
            rawParams: source,
            dataSource: Object.keys(req.query).length > 0 ? 'query' : 'body',
          },
        });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Error in searchNiveau6:', err);
      res.status(500).json({
        success: false,
        message: err.message,
        debug: { function: 'searchNiveau6', queryParams: req.query, body: req.body, error: err.message },
      });
    }
  }
  ,
  async searchNiveau7(req, res) {
    try {
      const source = Object.keys(req.query).length > 0 ? req.query : req.body;
      const { q = '', niveau1, niveau2, niveau3, niveau4, niveau5, niveau6 } = source;

      console.log('=== SEARCH NIVEAU 7 WITH FALLBACK ===');
      console.log('Extracted params:', { q, niveau1, niveau2, niveau3, niveau4, niveau5, niveau6 });

      const filterLevels = [
        { param: niveau1, field: 'Niveau_1', level: 1 },
        { param: niveau2, field: 'Niveau_2__lot', level: 2 },
        { param: niveau3, field: 'Niveau_3', level: 3 },
        { param: niveau4, field: 'Niveau_4', level: 4 },
        { param: niveau5, field: 'Orientation_localisation', level: 5 },
      ];

      const normalizeFilter = (value) => {
        if (!value) return null;
        const normalized = value.toString().trim();
        if (!normalized || normalized === 'undefined' || normalized === 'null') {
          return null;
        }
        return normalized;
      };

      let filters = {};
      const activeFilters = [];

      for (const { param, field, level } of filterLevels) {
        const normalized = normalizeFilter(param);
        if (normalized) {
          filters[field] = normalized;
          activeFilters.push({ field, value: normalized, level });
          console.log(`Added niveau${level} filter: ${field} = "${normalized}"`);
        }
      }

      const niveau6Value = normalizeFilter(niveau6);
      if (niveau6Value) {
        const isNumeric = /^\d+$/.test(niveau6Value);
        const field = isNumeric ? 'id_niv_6' : 'Niveau_5__article';
        filters[field] = niveau6Value;
        activeFilters.push({ field, value: niveau6Value, level: 6 });
        console.log(`Added niveau6 filter: ${field} = "${niveau6Value}" (${isNumeric ? 'id' : 'label'})`);
      }

      console.log('Initial filters:', filters);
      console.log('Active filter count:', activeFilters.length);

      let results = await Article.searchNormalizedDistinct('Niveau_6__detail_article', q, filters);
      let fallbackAttempts = [];

      // Fallback logic
      if (results.length === 0 && activeFilters.length > 1) {
        console.log('No results with all filters, trying fallback strategy...');

        for (let i = activeFilters.length - 1; i >= 0 && results.length === 0; i--) {
          const fallbackFilters = {};
          const remainingFilters = activeFilters.slice(0, i);

          remainingFilters.forEach(filter => {
            fallbackFilters[filter.field] = filter.value;
          });

          console.log(`Fallback attempt ${activeFilters.length - i}: Using ${remainingFilters.length} filters`);
          console.log('Fallback filters:', fallbackFilters);

          results = await Article.searchNormalizedDistinct('Niveau_6__detail_article', q, fallbackFilters);

          if (results.length > 0) {
            fallbackAttempts.push({
              removedLevels: activeFilters.slice(i).map(f => f.level),
              remainingFilters: remainingFilters.map(f => f.level),
              resultCount: results.length
            });
            console.log(`SUCCESS: Found ${results.length} results with ${remainingFilters.length} filters`);
            filters = fallbackFilters;
            break;
          } else {
            fallbackAttempts.push({
              removedLevels: activeFilters.slice(i).map(f => f.level),
              remainingFilters: remainingFilters.map(f => f.level),
              resultCount: 0
            });
          }
        }

        if (results.length === 0) {
          console.log('Still no results, trying with no filters...');
          results = await Article.searchNormalizedDistinct('Niveau_6__detail_article', q, {});
          if (results.length > 0) {
            fallbackAttempts.push({
              removedLevels: activeFilters.map(f => f.level),
              remainingFilters: [],
              resultCount: results.length
            });
            console.log(`FALLBACK SUCCESS: Found ${results.length} results with no filters`);
            filters = {};
          }
        }
      }

      console.log('Final result count:', results.length);
      console.log('Sample results:', results.slice(0, 5));

      res.json({
        success: true,
        data: results || [],
        debug: {
          searchColumn: 'nom_article',
          searchTerm: q,
          originalFilterCount: activeFilters.length,
          appliedFilters: filters,
          filterCount: Object.keys(filters).length,
          resultCount: results ? results.length : 0,
          rawParams: source,
          dataSource: Object.keys(req.query).length > 0 ? 'query' : 'body',
          fallbackAttempts: fallbackAttempts,
          strategy: fallbackAttempts.length > 0 ? 'Used fallback filtering' : 'Used original filters'
        }
      });
    } catch (err) {
      console.error('Error in searchNiveau7:', err);
      res.status(500).json({
        success: false,
        message: err.message,
        debug: {
          function: 'searchNiveau7',
          queryParams: req.query || {},
          body: req.body || {},
          error: err.message
        }
      });
    }
  }
  ,
  async searchName(req, res) {
    try {
      const { q, niveau1, niveau2, niveau3, niveau4, niveau5, niveau6 } = req.query;
      let query = `SELECT DISTINCT "nom_article" AS "article_name" FROM articles WHERE "nom_article" IS NOT NULL AND "nom_article" != ''`;
      const values = [];
      const conditions = [];

      if (niveau1) {
        values.push(niveau1.toLowerCase());
        conditions.push(`LOWER("Niveau_1") = LOWER($${values.length})`);
      }
      if (niveau2) {
        values.push(niveau2.toLowerCase());
        conditions.push(`LOWER("Niveau_2__lot") = LOWER($${values.length})`);
      }
      if (niveau3) {
        values.push(niveau3.toLowerCase());
        conditions.push(`LOWER("Niveau_3") = LOWER($${values.length})`);
      }
      if (niveau4) {
        values.push(niveau4.toLowerCase());
        conditions.push(`LOWER("Niveau_4") = LOWER($${values.length})`);
      }
      if (niveau5) {
        values.push(niveau5.toLowerCase());
        conditions.push(`LOWER("Orientation_localisation") = LOWER($${values.length})`);
      }
      if (niveau6) {
        values.push(niveau6.toLowerCase());
        conditions.push(`LOWER("Niveau_5__article") = LOWER($${values.length})`);
      }

      if (q) {
        values.push(`%${q.toLowerCase()}%`);
        conditions.push(`LOWER("nom_article") LIKE $${values.length}`);
      }

      if (conditions.length > 0) {
        query += ` AND ${conditions.join(' AND ')}`;
      }

      const result = await pool.query(query, values);
      
      // Deduplicate results: remove duplicates by normalizing and comparing
      const articleNames = result.rows.map((row) => row.article_name).filter(Boolean);
      const seen = new Set();
      const uniqueNames = [];
      for (const name of articleNames) {
        // Normalize the name for comparison (lowercase, trim, remove accents)
        const normalized = name
          .toString()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim();
        
        if (!seen.has(normalized)) {
          seen.add(normalized);
          uniqueNames.push(name);
        }
      }

      res.json({
        success: true,
        data: uniqueNames,
      });
    } catch (error) {
      console.error('Error in searchName:', error);
      res.status(500).json({ success: false, error: 'Server error' });
    }
  }
  ,
  async searchUnite(req, res) {
    try {
      const { q } = req.query;
      const results = await Article.searchDistinct('Unite', q);
      res.json({ success: true, data: results });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  async searchNames(req, res) {
    try {
      const { q, niveau1, niveau2, niveau3, niveau4, niveau5, niveau6 } = req.query;
      let results;

      const filters = {};
      if (niveau1) filters.Niveau_1 = niveau1;
      if (niveau2) filters.Niveau_2__lot = niveau2;
      if (niveau3) filters.Niveau_3 = niveau3;
      if (niveau4) filters.Niveau_4 = niveau4;
      if (niveau5) filters.Orientation_localisation = niveau5;
      if (niveau6) filters.nom_article = niveau6;

      if (Object.keys(filters).length > 0) {
        results = await Article.searchDistinctWithFilter('Niveau_5__article', q, filters);
      } else {
        results = await Article.searchDistinct('Niveau_5__article', q);
      }

      // Deduplicate results: remove duplicates by normalizing and comparing
      const seen = new Set();
      const uniqueResults = [];
      for (const value of results) {
        if (!value) continue;
        // Normalize the value for comparison (lowercase, trim, remove accents)
        const normalized = value
          .toString()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim();
        
        if (!seen.has(normalized)) {
          seen.add(normalized);
          uniqueResults.push(value);
        }
      }

      res.json({ success: true, data: uniqueResults });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  async searchOriginePrestation(req, res) {
    try {
      const { q, type_prestation } = req.query;
      console.log('=== SEARCH ORIGINE PRESTATION ===');
      console.log('Search query:', q);
      console.log('Type prestation:', type_prestation);

      // Fetch from fournisseur table based on type, not Origine_Prestation from articles
      const client = await pool.connect();
      try {
        let query;
        let params;

        if (type_prestation) {
          // Map normalized type values to database values
          // Handles both old format ('fournisseur', 'entreprise', 'négociant') and new format ('Fabricant (Fournisseur)', etc.)
          const normalizedType = type_prestation.toString().toLowerCase().trim();
          let dbTypeValue = type_prestation;
          
          // Map normalized values to database values
          if (normalizedType === 'fournisseur' || normalizedType.includes('fabricant') || normalizedType.includes('fournisseur')) {
            dbTypeValue = 'Fabricant (Fournisseur)';
          } else if (normalizedType === 'entreprise' || normalizedType.includes('prestataire') || normalizedType.includes('entreprise')) {
            dbTypeValue = 'Prestataire - entreprise (Entreprise)';
          } else if (normalizedType === 'négociant' || normalizedType === 'negociant' || normalizedType.includes('negociant')) {
            dbTypeValue = 'Negociant (Négociant)';
          }
          
          // Base query to fetch fournisseurs of the given type (accent/case-insensitive)
          // Use LIKE to match both full format and partial matches
          query = `SELECT nom_fournisseur FROM fournisseur WHERE (unaccent(TRIM(LOWER(type))) = unaccent(TRIM(LOWER($1))) OR unaccent(TRIM(LOWER(type))) LIKE unaccent(TRIM(LOWER($2)))) AND nom_fournisseur IS NOT NULL AND nom_fournisseur != ''`;
          params = [dbTypeValue, `%${normalizedType}%`];

          if (q) {
            query += ` AND unaccent(TRIM(LOWER(nom_fournisseur))) LIKE unaccent(TRIM(LOWER($2)))`;
            params.push(`%${q}%`);
          }
          query += ` ORDER BY nom_fournisseur`;
        } else {
          // Fallback: if no type, return empty (we require type now)
          console.log('No type_prestation provided; returning empty results');
          return res.json({ success: true, data: [] });
        }

        console.log('Executing searchOriginePrestation query:', query);
        console.log('With params:', params);

        const result = await client.query(query, params);
        const results = result.rows.map((row) => row.nom_fournisseur);

        console.log('Raw results from database:', results);

        // Remove duplicates and sort
        const uniqueResults = [...new Set(results)];
        const finalResults = uniqueResults.sort();

        console.log('Final cleaned and unique results:', finalResults);
        res.json({ success: true, data: finalResults });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Error in searchOriginePrestation:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
};

module.exports = articleController;
