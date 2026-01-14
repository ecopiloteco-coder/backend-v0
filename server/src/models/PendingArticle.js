const pool = require('../../config/db');
const { moveFilesFromPendingToArticles } = require('../utils/supabase');
const NiveauService = require('../services/NiveauService');

const PENDING_ARTICLE_HIERARCHY_JOIN = NiveauService.getArticleHierarchyJoin('p');
const PENDING_ARTICLE_HIERARCHY_FIELDS = NiveauService.getArticleHierarchySelectFields('p');

class PendingArticle {
  /**
   * Ensure pending_articles table has the correct columns
   */
  static async ensureTableColumns() {
    const client = await pool.connect();
    try {
      await client.query('ALTER TABLE pending_articles ADD COLUMN IF NOT EXISTS "Indice_de_confiance" INTEGER DEFAULT 3');
      await client.query('ALTER TABLE pending_articles ADD COLUMN IF NOT EXISTS "approved_article_id" INTEGER');
      await client.query('ALTER TABLE pending_articles ADD COLUMN IF NOT EXISTS "fournisseur" INTEGER REFERENCES fournisseur(id_fournisseur)');
      
      // Check if files column exists and is TEXT
      const filesColumnCheck = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = 'pending_articles' AND column_name = 'files'
      `);
      
      if (filesColumnCheck.rows.length === 0) {
        await client.query('ALTER TABLE pending_articles ADD COLUMN "files" TEXT');
        console.log('Files column added as TEXT');
      } else if (filesColumnCheck.rows[0].data_type !== 'text') {
        console.log('Files column is not TEXT, converting...');
        await client.query('ALTER TABLE pending_articles DROP COLUMN "files"');
        await client.query('ALTER TABLE pending_articles ADD COLUMN "files" TEXT');
        console.log('Files column converted to TEXT');
      }

      await client.query('ALTER TABLE pending_articles ADD COLUMN IF NOT EXISTS "nom_article" TEXT');
      await client.query('ALTER TABLE pending_articles ADD COLUMN IF NOT EXISTS "id_niv_6" INTEGER REFERENCES niveau_6(id_niveau_6)');
      console.log('Pending articles table columns ensured');
    } catch (err) {
      console.error('Error ensuring pending articles table columns:', err);
    } finally {
      client.release();
    }
  }

  /**
   * Count pending articles excluding those approved
   */
  static async countNotApproved() {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT COUNT(*)::int AS total
         FROM pending_articles
         WHERE COALESCE(status, 'En attente') IS DISTINCT FROM 'Approuvé'`
      );
      return { total: res.rows[0]?.total || 0 };
    } finally {
      client.release();
    }
  }

  /**
   * Count articles strictly in 'En attente' status (NULL treated as 'En attente')
   */
  static async countPendingOnly() {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT COUNT(*)::int AS total
         FROM pending_articles
         WHERE COALESCE(status, 'En attente') = 'En attente'`
      );
      return { total: res.rows[0]?.total || 0 };
    } finally {
      client.release();
    }
  }

  /**
   * Find all pending articles with pagination
   */
  static async findAll({ page = 1, limit = 10 }) {
    const offset = (page - 1) * limit;
    const client = await pool.connect();
    
    try {
      const [countRes, listRes] = await Promise.all([
        client.query('SELECT COUNT(*)::int AS total FROM pending_articles'),
        client.query(`
          SELECT 
            p.*,
            ${PENDING_ARTICLE_HIERARCHY_FIELDS},
            u.nom_utilisateur AS created_by_name,
            f.nom_fournisseur AS fournisseur_nom,
            f.type AS fournisseur_type,
            CASE 
                WHEN p."reviewed_by" IS NOT NULL THEN p."reviewed_by"
                ELSE NULL
            END AS admin_name,
            CASE 
                WHEN p."updated_at" IS NOT NULL AND p."updated_at" != p."submitted_at" THEN 'Modifié'
                WHEN p."status" = 'Approuvé' THEN 'Approuvé'
                WHEN p."status" = 'Rejeté' THEN 'Rejeté'
                ELSE 'En attente'
            END AS display_status
          FROM pending_articles p
          ${PENDING_ARTICLE_HIERARCHY_JOIN}
          LEFT JOIN users u ON u.id = p."created_by"
          LEFT JOIN fournisseur f ON f.id_fournisseur = p."fournisseur"
          ORDER BY COALESCE(p."updated_at", p."submitted_at") DESC
          LIMIT $1 OFFSET $2
        `, [limit, offset])
      ]);

      const total = countRes.rows[0]?.total || 0;
      const data = listRes.rows;

      return { data, total, page, limit };
    } finally {
      client.release();
    }
  }

  /**
   * Find pending articles by user ID
   */
  static async findByUserId({ userId, page = 1, limit = 10 }) {
    const offset = (page - 1) * limit;
    const client = await pool.connect();
    
    try {
      const countSql = `SELECT COUNT(*)::int AS total FROM pending_articles WHERE "created_by" = $1`;
      const listSql = `
        SELECT 
          p.*,
          ${PENDING_ARTICLE_HIERARCHY_FIELDS},
          u.nom_utilisateur AS created_by_name,
          f.nom_fournisseur AS fournisseur_nom,
          f.type AS fournisseur_type,
          CASE 
              WHEN p."reviewed_by" IS NOT NULL THEN p."reviewed_by"
              ELSE NULL
          END AS admin_name,
          CASE 
              WHEN p."updated_at" IS NOT NULL AND p."updated_at" != p."submitted_at" THEN 'Modifié'
              WHEN p."status" = 'Approuvé' THEN 'Approuvé'
              WHEN p."status" = 'Rejeté' THEN 'Rejeté'
              ELSE 'En attente'
          END AS display_status
        FROM pending_articles p
        ${PENDING_ARTICLE_HIERARCHY_JOIN}
        LEFT JOIN users u ON u.id = p."created_by"
        LEFT JOIN fournisseur f ON f.id_fournisseur = p."fournisseur"
        WHERE p."created_by" = $1
        ORDER BY COALESCE(p."reviewed_at", p."updated_at", p."submitted_at") DESC
        LIMIT $2 OFFSET $3
      `;

      const [{ rows: [{ total }] }, { rows: data }] = await Promise.all([
        client.query(countSql, [userId]),
        client.query(listSql, [userId, limit, offset])
      ]);

      return { data, total, page, limit };
    } finally {
      client.release();
    }
  }

  /**
   * Find pending article by ID
   */
    static async findById(id) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT 
           p.*, 
           ${PENDING_ARTICLE_HIERARCHY_FIELDS},
           f.nom_fournisseur AS fournisseur_nom, 
           f.type AS fournisseur_type
         FROM pending_articles p
         ${PENDING_ARTICLE_HIERARCHY_JOIN}
         LEFT JOIN fournisseur f ON f.id_fournisseur = p."fournisseur"
         WHERE p."ID" = $1`,
        [id]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  /**
   * Find deleted (archived) article by ID
   */
  static async findDeletedById(id) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT 
          a.*, 
          niv1.niveau_1 AS "Niveau_1",
          niv2.niveau_2 AS "Niveau_2__lot",
          niv3.niveau_3 AS "Niveau_3",
          niv4.niveau_4 AS "Niveau_4",
          niv5.niveau_5 AS "Orientation_localisation",
          niv6.niveau_6 AS "Niveau_5__article",
          a."nom_article" AS "Niveau_6__detail_article",
          'Supprimé'::varchar AS status,
          NULL::varchar AS reviewed_by,
          NULL::timestamp AS reviewed_at,
          NULL::varchar AS admin_name,
          'Supprimé'::varchar AS display_status
         FROM articles_supprime a
        LEFT JOIN niveau_6 niv6 ON a."id_niv_6" = niv6.id_niveau_6
        LEFT JOIN niveau_5 niv5 ON niv6.id_niv_5 = niv5.id_niveau_5
        LEFT JOIN niveau_4 niv4 ON niv5.id_niveau_4 = niv4.id_niveau_4
        LEFT JOIN niveau_3 niv3 ON niv4.id_niveau_3 = niv3.id_niveau_3
        LEFT JOIN niveau_2 niv2 ON niv3.id_niveau_2 = niv2.id_niveau_2
        LEFT JOIN niveau_1 niv1 ON niv2.id_niveau_1 = niv1.id_niveau_1
         WHERE a."ID" = $1`,
        [id]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  /**
   * Create a new pending article
   */
  static async create(articleData, userId) {
    const client = await pool.connect();
    
    try {
      await this.ensureTableColumns();
      
      const {
        Date, Unite, Type, Expertise, Fourniture, Cadence,
        Accessoires, Pertes, PU, Prix_Cible, Prix_estime, Prix_consulte, Rabais,
        Commentaires, Indice_de_confiance, files, fournisseur, id_niv_6,
      } = articleData;

      const finalArticleNameInput = typeof articleData.article_name === 'string'
        ? articleData.article_name.trim()
        : (typeof articleData.nom_article === 'string' ? articleData.nom_article.trim() : null);
      const finalArticleName = finalArticleNameInput || (typeof articleData.Niveau_6__detail_article === 'string' ? articleData.Niveau_6__detail_article.trim() : null);

      // Resolve hierarchy using same logic as Article.create() - pass id_niv_6 if provided
      const hierarchyResult = await NiveauService.resolveHierarchyId(client, {
        id_niv_6,
        Niveau_1: articleData.Niveau_1,
        Niveau_2__lot: articleData.Niveau_2__lot,
        Niveau_3: articleData.Niveau_3,
        Niveau_4: articleData.Niveau_4,
        Orientation_localisation: articleData.Orientation_localisation,
        Niveau_5__article: articleData.Niveau_5__article,
      });
      
      if (!hierarchyResult?.id_niveau_6) {
        throw new Error('Unable to resolve hierarchy for pending article. Provide Niveau 1-6 values.');
      }

      let processedFiles = null;
      if (typeof files === 'string' && files.trim() !== '') {
        processedFiles = files;
      } else if (Array.isArray(files)) {
        processedFiles = JSON.stringify(files);
      }

      const insertValues = [
        Date, 
        finalArticleName,
        hierarchyResult.id_niveau_6,
        Unite, Type, Expertise,
        parseFloat(Fourniture) || 0,
        parseFloat(Cadence) || 0,
        parseFloat(Accessoires) || 0,
        Pertes,
        PU,
        parseFloat(Prix_Cible) || 0,
        parseFloat(Prix_estime) || 0,
        parseFloat(Prix_consulte) || 0,
        Rabais,
        Commentaires,
        userId,
        parseInt(Indice_de_confiance) || 3,
        processedFiles,
        fournisseur || null
      ];
      
      const result = await client.query(
        `INSERT INTO pending_articles (
        "Date", "nom_article", "id_niv_6", "Unite", "Type", "Expertise", "Fourniture", "Cadence",
          "Accessoires", "Pertes", "PU", "Prix_Cible", "Prix_estime", "Prix_consulte", "Rabais",
          "Commentaires", "created_by", "Indice_de_confiance", "files", "fournisseur"
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
        ) RETURNING *`,
        insertValues
      );
      
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  /**
   * Update a pending article
   */
  static async update(id, updateData, userId, isAdmin) {
    const client = await pool.connect();
    
    try {
      // Check ownership
      const ownerCheck = await client.query(
        'SELECT "created_by" FROM pending_articles WHERE "ID" = $1', 
        [id]
      );

      if (ownerCheck.rows.length === 0) {
        return { error: 'Pending article not found', status: 404 };
      }

      if (!isAdmin && ownerCheck.rows[0].created_by !== userId) {
        return { error: 'Accès refusé', status: 403 };
      }

      const allowedColumns = [
        'Date', 'Niveau_1', 'Niveau_2__lot', 'Niveau_3', 'Niveau_4',
        'Orientation_localisation', 'Niveau_5__article', 'Niveau_6__detail_article',
        'nom_article', 'id_niv_6',
        'Unite', 'Type', 'Expertise', 'Fourniture', 'Cadence', 'Accessoires',
        'Pertes', 'PU', 'Prix_Cible', 'Prix_estime', 'Prix_consulte',
        'Rabais', 'Commentaires', 'status',
        'reviewed_by', 'reviewed_at', 'Indice_de_confiance', 'files', 'fournisseur'
      ];

      if (!updateData.nom_article) {
        if (typeof updateData.article_name === 'string') {
          updateData.nom_article = updateData.article_name;
        } else if (typeof updateData.Niveau_6__detail_article === 'string') {
          updateData.nom_article = updateData.Niveau_6__detail_article;
        }
      }
      if (updateData.article_name) {
        delete updateData.article_name;
      }

      let fields = Object.keys(updateData).filter(
        key => key !== 'ID' && allowedColumns.includes(key)
      );

      // Check if any hierarchy fields are being updated
      const hasHierarchyFields = updateData.Niveau_1 || updateData.Niveau_2__lot || 
                                 updateData.Niveau_3 || updateData.Niveau_4 || 
                                 updateData.Orientation_localisation || updateData.Niveau_5__article ||
                                 updateData.Niveau_6__detail_article;

      // Resolve hierarchy: if hierarchy fields are being updated, resolve from them
      // Don't pass id_niv_6 if hierarchy fields are present, so it resolves from the new hierarchy
      if (hasHierarchyFields) {
        const hierarchyResult = await NiveauService.resolveHierarchyId(client, {
          // Don't pass id_niv_6 when hierarchy fields are updated - let it resolve from hierarchy
          Niveau_1: updateData.Niveau_1,
          Niveau_2__lot: updateData.Niveau_2__lot,
          Niveau_3: updateData.Niveau_3,
          Niveau_4: updateData.Niveau_4,
          Orientation_localisation: updateData.Orientation_localisation,
          Niveau_5__article: updateData.Niveau_5__article,
          Niveau_6__detail_article: updateData.Niveau_6__detail_article,
        });
        
        if (hierarchyResult?.id_niveau_6) {
          updateData.id_niv_6 = hierarchyResult.id_niveau_6;
          if (!fields.includes('id_niv_6')) {
            fields.push('id_niv_6');
          }
        }
      } else if (updateData.id_niv_6 !== undefined && updateData.id_niv_6 !== null) {
        // If only id_niv_6 is being updated (no hierarchy fields), allow direct update
        if (!fields.includes('id_niv_6')) {
          fields.push('id_niv_6');
        }
      }

      if (fields.length === 0) {
        return { error: 'No valid fields to update', status: 400 };
      }

      const virtualColumns = new Set([
        'Niveau_1', 'Niveau_2__lot', 'Niveau_3', 'Niveau_4',
        'Orientation_localisation', 'Niveau_5__article', 'Niveau_6__detail_article'
      ]);

      const writableFields = fields.filter(field => !virtualColumns.has(field));

      const setClause = writableFields
        .map((field, idx) => `"${field}" = $${idx + 2}`)
        .join(', ');
      const finalSetClause = `${setClause}, "updated_at" = CURRENT_TIMESTAMP`;
      const values = [id, ...writableFields.map(f => updateData[f])];

      const query = `UPDATE pending_articles SET ${finalSetClause} WHERE "ID" = $1 RETURNING *`;
      const result = await client.query(query, values);

      if (result.rows.length === 0) {
        return { error: 'Pending article not found', status: 404 };
      }

      return { data: result.rows[0] };
    } finally {
      client.release();
    }
  }

  /**
   * Approve a pending article (move to main articles table)
   */
  static async approve(id, adminName) {
    const client = await pool.connect();
    
    try {
      const pendingResult = await client.query('SELECT * FROM pending_articles WHERE "ID" = $1', [id]);
      if (pendingResult.rows.length === 0) {
        return { error: 'Pending article not found', status: 404 };
      }
      
      const article = pendingResult.rows[0];
      
      // Ensure main articles table has the new columns
      try {
        await client.query('ALTER TABLE articles ADD COLUMN IF NOT EXISTS "files" TEXT');
        await client.query('ALTER TABLE articles ADD COLUMN IF NOT EXISTS "Indice_de_confiance" INTEGER DEFAULT 3');
        await client.query('ALTER TABLE articles ADD COLUMN IF NOT EXISTS "fournisseur" INTEGER REFERENCES fournisseur(id_fournisseur)');
      } catch (colErr) {
        console.error('Error ensuring articles table columns:', colErr.message);
      }
      
      // Process files: move from pending-articles to articles bucket
      let processedFiles = typeof article.files === 'string' ? article.files : null;
      if (processedFiles) {
        try {
          if (typeof moveFilesFromPendingToArticles === 'function') {
            processedFiles = await moveFilesFromPendingToArticles(processedFiles);
          }
        } catch (e) {
          console.warn('Failed to move files from pending-articles to articles:', e?.message || e);
        }
      }
      
      const insertData = [
        article.Date, article.nom_article, article.id_niv_6,
        article.Unite, article.Type, article.Expertise, article.Fourniture, article.Cadence,
        article.Accessoires, article.Pertes, article.PU, article.Prix_Cible,
        article.Prix_estime, article.Prix_consulte, article.Rabais,
        article.Commentaires, article.created_by,
        article.Indice_de_confiance || 3,
        processedFiles,
        article.fournisseur
      ];
      
      const insertResult = await client.query(
        `INSERT INTO articles (
          "Date", "nom_article", "id_niv_6", "Unite", "Type", "Expertise", "Fourniture", "Cadence",
          "Accessoires", "Pertes", "PU", "Prix_Cible", "Prix_estime", "Prix_consulte", "Rabais",
          "Commentaires", "User", "Indice_de_confiance", "files", "fournisseur"
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
        ) RETURNING *`,
        insertData
      );
      
      await client.query(
        'UPDATE pending_articles SET "status" = $1, "reviewed_by" = $2, "reviewed_at" = CURRENT_TIMESTAMP, "approved_article_id" = $4 WHERE "ID" = $3',
        ['Approuvé', adminName, id, insertResult.rows[0].ID]
      );
      
      return { data: insertResult.rows[0] };
    } finally {
      client.release();
    }
  }

  /**
   * Reject a pending article
   */
  static async reject(id, adminName) {
    const client = await pool.connect();
    
    try {
      await client.query(
        'UPDATE pending_articles SET "status" = $1, "rejected_by" = $2, "reviewed_at" = CURRENT_TIMESTAMP, "reviewed_by" = NULL WHERE "ID" = $3',
        ['Rejeté', adminName, id]
      );
      
      return { success: true };
    } finally {
      client.release();
    }
  }

  /**
   * Delete a pending article (archive to articles_supprime if admin)
   */
  static async delete(id, userId, isAdmin, adminName) {
    const client = await pool.connect();
    
    try {
      const ownerCheck = await client.query('SELECT * FROM pending_articles WHERE "ID" = $1', [id]);
      if (ownerCheck.rows.length === 0) {
        return { error: 'Pending article not found', status: 404 };
      }
      
      if (!isAdmin && ownerCheck.rows[0].created_by !== userId) {
        return { error: 'Accès refusé', status: 403 };
      }

      const pending = ownerCheck.rows[0];

      if (isAdmin) {
        // Ensure articles_supprime has needed columns
        try {
          await client.query('ALTER TABLE articles_supprime ADD COLUMN IF NOT EXISTS "files" TEXT');
          await client.query('ALTER TABLE articles_supprime ADD COLUMN IF NOT EXISTS "Indice_de_confiance" INTEGER DEFAULT 3');
          await client.query('ALTER TABLE articles_supprime ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(255)');
          await client.query('ALTER TABLE articles_supprime ADD COLUMN IF NOT EXISTS "fournisseur" INTEGER REFERENCES fournisseur(id_fournisseur)');
          await client.query('ALTER TABLE articles_supprime ADD COLUMN IF NOT EXISTS "nom_article" TEXT');
          await client.query('ALTER TABLE articles_supprime ADD COLUMN IF NOT EXISTS "id_niv_6" INTEGER REFERENCES niveau_6(id_niveau_6)');
        } catch (colErr) {
          console.warn('Error ensuring articles_supprime columns:', colErr.message);
        }

        const archivedFiles = typeof pending.files === 'string' ? pending.files : null;

        const insertValues = [
          pending.Date, pending.nom_article, pending.id_niv_6,
          pending.Unite, pending.Type, pending.Expertise, pending.Fourniture, pending.Cadence,
          pending.Accessoires, pending.Pertes, pending.PU, pending.Prix_Cible,
          pending.Prix_estime, pending.Prix_consulte, pending.Rabais,
          pending.Commentaires, pending.created_by, (pending.Indice_de_confiance || 3),
          archivedFiles, adminName, pending.fournisseur
        ];

        await client.query(
          `INSERT INTO articles_supprime (
            "Date", "nom_article", "id_niv_6", "Unite", "Type", "Expertise", "Fourniture", "Cadence",
            "Accessoires", "Pertes", "PU", "Prix_Cible", "Prix_estime", "Prix_consulte", "Rabais",
            "Commentaires", "User", "Indice_de_confiance", "files", deleted_by, "fournisseur"
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
        )`,
          insertValues
        );
      }

      const deleteRes = await client.query('DELETE FROM pending_articles WHERE "ID" = $1 RETURNING *', [id]);
      return { data: deleteRes.rows[0] };
    } finally {
      client.release();
    }
  }
}

module.exports = PendingArticle;
