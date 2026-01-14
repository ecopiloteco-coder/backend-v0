const pool = require('../../config/db');

/**
 * Référentiel Controller
 * Handles hierarchical navigation through niveau_1 to niveau_6 and articles
 */

class ReferentielController {
  /**
   * Get all niveau_1 records with child count
   */
  static async getNiveau1(req, res) {
    const client = await pool.connect();
    try {
      const query = `
        SELECT 
          n1.id_niveau_1,
          n1.niveau_1,
          COUNT(DISTINCT n2.id_niveau_2) as child_count
        FROM niveau_1 n1
        LEFT JOIN niveau_2 n2 ON n2.id_niv_1 = n1.id_niveau_1
        GROUP BY n1.id_niveau_1, n1.niveau_1
        ORDER BY n1.niveau_1
      `;
      
      const result = await client.query(query);
      
      res.json({
        success: true,
        data: result.rows,
        count: result.rows.length
      });
    } catch (error) {
      console.error('Error fetching niveau 1:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des données niveau 1',
        error: error.message
      });
    } finally {
      client.release();
    }
  }

  /**
   * Get niveau_2 records by parent niveau_1 id
   */
  static async getNiveau2(req, res) {
    const client = await pool.connect();
    try {
      const { parent } = req.query;
      
      if (!parent) {
        return res.status(400).json({
          success: false,
          message: 'Le paramètre parent est requis'
        });
      }

      const query = `
        SELECT 
          n2.id_niveau_2,
          n2.niveau_2,
          n2.id_niv_1,
          COUNT(DISTINCT n3.id_niveau_3) as child_count
        FROM niveau_2 n2
        LEFT JOIN niveau_3 n3 ON n3.id_niv_2 = n2.id_niveau_2
        WHERE n2.id_niv_1 = $1
        GROUP BY n2.id_niveau_2, n2.niveau_2, n2.id_niv_1
        ORDER BY n2.niveau_2
      `;
      
      const result = await client.query(query, [parent]);
      
      res.json({
        success: true,
        data: result.rows,
        count: result.rows.length
      });
    } catch (error) {
      console.error('Error fetching niveau 2:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des données niveau 2',
        error: error.message
      });
    } finally {
      client.release();
    }
  }

  /**
   * Get niveau_3 records by parent niveau_2 id
   */
  static async getNiveau3(req, res) {
    const client = await pool.connect();
    try {
      const { parent } = req.query;
      
      if (!parent) {
        return res.status(400).json({
          success: false,
          message: 'Le paramètre parent est requis'
        });
      }

      const query = `
        SELECT 
          n3.id_niveau_3,
          n3.niveau_3,
          n3.id_niv_2,
          COUNT(DISTINCT n4.id_niveau_4) as child_count
        FROM niveau_3 n3
        LEFT JOIN niveau_4 n4 ON n4.id_niv_3 = n3.id_niveau_3
        WHERE n3.id_niv_2 = $1
        GROUP BY n3.id_niveau_3, n3.niveau_3, n3.id_niv_2
        ORDER BY n3.niveau_3
      `;
      
      const result = await client.query(query, [parent]);
      
      res.json({
        success: true,
        data: result.rows,
        count: result.rows.length
      });
    } catch (error) {
      console.error('Error fetching niveau 3:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des données niveau 3',
        error: error.message
      });
    } finally {
      client.release();
    }
  }

  /**
   * Get niveau_4 records by parent niveau_3 id
   */
  static async getNiveau4(req, res) {
    const client = await pool.connect();
    try {
      const { parent } = req.query;
      
      if (!parent) {
        return res.status(400).json({
          success: false,
          message: 'Le paramètre parent est requis'
        });
      }

      // niveau_5 can have id_niv_4 OR skip directly to id_niv_3
      // We count niveau_5 children that have id_niv_4 = this niveau_4
      const query = `
        SELECT 
          n4.id_niveau_4,
          n4.niveau_4,
          n4.id_niv_3,
          COUNT(DISTINCT n5.id_niveau_5) as child_count
        FROM niveau_4 n4
        LEFT JOIN niveau_5 n5 ON n5.id_niv_4 = n4.id_niveau_4
        WHERE n4.id_niv_3 = $1
        GROUP BY n4.id_niveau_4, n4.niveau_4, n4.id_niv_3
        ORDER BY n4.niveau_4
      `;
      
      const result = await client.query(query, [parent]);
      
      res.json({
        success: true,
        data: result.rows,
        count: result.rows.length
      });
    } catch (error) {
      console.error('Error fetching niveau 4:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des données niveau 4',
        error: error.message
      });
    } finally {
      client.release();
    }
  }

  /**
   * Get niveau_5 records by parent niveau_4 id
   */
  static async getNiveau5(req, res) {
    const client = await pool.connect();
    try {
      const { parent } = req.query;
      
      if (!parent) {
        return res.status(400).json({
          success: false,
          message: 'Le paramètre parent est requis'
        });
      }

      // niveau_6 can have id_niv_5 OR skip to id_niv_4 or id_niv_3
      // We count niveau_6 children that have id_niv_5 = this niveau_5
      const query = `
        SELECT 
          n5.id_niveau_5,
          n5.niveau_5,
          n5.id_niv_4,
          n5.id_niv_3,
          COUNT(DISTINCT n6.id_niveau_6) as child_count
        FROM niveau_5 n5
        LEFT JOIN niveau_6 n6 ON n6.id_niv_5 = n5.id_niveau_5
        WHERE n5.id_niv_4 = $1
        GROUP BY n5.id_niveau_5, n5.niveau_5, n5.id_niv_4, n5.id_niv_3
        ORDER BY n5.niveau_5
      `;
      
      const result = await client.query(query, [parent]);
      
      res.json({
        success: true,
        data: result.rows,
        count: result.rows.length
      });
    } catch (error) {
      console.error('Error fetching niveau 5:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des données niveau 5',
        error: error.message
      });
    } finally {
      client.release();
    }
  }

  /**
   * Get niveau_6 records by parent niveau_5 id
   */
  static async getNiveau6(req, res) {
    const client = await pool.connect();
    try {
      const { parent } = req.query;
      
      if (!parent) {
        return res.status(400).json({
          success: false,
          message: 'Le paramètre parent est requis'
        });
      }

      // Count articles that reference this niveau_6
      const query = `
        SELECT 
          n6.id_niveau_6,
          n6.niveau_6,
          n6.id_niv_5,
          n6.id_niv_4,
          n6.id_niv_3,
          COUNT(DISTINCT a."ID") as child_count
        FROM niveau_6 n6
        LEFT JOIN articles a ON a."id_niv_6" = n6.id_niveau_6
        WHERE n6.id_niv_5 = $1
        GROUP BY n6.id_niveau_6, n6.niveau_6, n6.id_niv_5, n6.id_niv_4, n6.id_niv_3
        ORDER BY n6.niveau_6
      `;
      
      const result = await client.query(query, [parent]);
      
      res.json({
        success: true,
        data: result.rows,
        count: result.rows.length
      });
    } catch (error) {
      console.error('Error fetching niveau 6:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des données niveau 6',
        error: error.message
      });
    } finally {
      client.release();
    }
  }

  /**
   * Get niveau_5 records that skip niveau_4 (directly under niveau_3)
   */
  static async getNiveau5ByNiveau3(req, res) {
    const client = await pool.connect();
    try {
      const { parent } = req.query;
      
      if (!parent) {
        return res.status(400).json({
          success: false,
          message: 'Le paramètre parent est requis'
        });
      }

      // Get niveau_5 that have id_niv_3 but id_niv_4 IS NULL (skip niveau_4)
      const query = `
        SELECT 
          n5.id_niveau_5,
          n5.niveau_5,
          n5.id_niv_4,
          n5.id_niv_3,
          COUNT(DISTINCT n6.id_niveau_6) as child_count
        FROM niveau_5 n5
        LEFT JOIN niveau_6 n6 ON n6.id_niv_5 = n5.id_niveau_5
        WHERE n5.id_niv_3 = $1 AND n5.id_niv_4 IS NULL
        GROUP BY n5.id_niveau_5, n5.niveau_5, n5.id_niv_4, n5.id_niv_3
        ORDER BY n5.niveau_5
      `;
      
      const result = await client.query(query, [parent]);
      
      res.json({
        success: true,
        data: result.rows,
        count: result.rows.length
      });
    } catch (error) {
      console.error('Error fetching niveau 5 by niveau 3:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des données niveau 5',
        error: error.message
      });
    } finally {
      client.release();
    }
  }

  /**
   * Get niveau_6 records that skip niveau_5 (directly under niveau_4)
   */
  static async getNiveau6ByNiveau4(req, res) {
    const client = await pool.connect();
    try {
      const { parent } = req.query;
      
      if (!parent) {
        return res.status(400).json({
          success: false,
          message: 'Le paramètre parent est requis'
        });
      }

      // Get niveau_6 that have id_niv_4 but id_niv_5 IS NULL (skip niveau_5)
      const query = `
        SELECT 
          n6.id_niveau_6,
          n6.niveau_6,
          n6.id_niv_5,
          n6.id_niv_4,
          n6.id_niv_3,
          COUNT(DISTINCT a."ID") as child_count
        FROM niveau_6 n6
        LEFT JOIN articles a ON a."id_niv_6" = n6.id_niveau_6
        WHERE n6.id_niv_4 = $1 AND n6.id_niv_5 IS NULL
        GROUP BY n6.id_niveau_6, n6.niveau_6, n6.id_niv_5, n6.id_niv_4, n6.id_niv_3
        ORDER BY n6.niveau_6
      `;
      
      const result = await client.query(query, [parent]);
      
      res.json({
        success: true,
        data: result.rows,
        count: result.rows.length
      });
    } catch (error) {
      console.error('Error fetching niveau 6 by niveau 4:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des données niveau 6',
        error: error.message
      });
    } finally {
      client.release();
    }
  }

  /**
   * Get niveau_6 records that skip niveau_4 and niveau_5 (directly under niveau_3)
   */
  static async getNiveau6ByNiveau3(req, res) {
    const client = await pool.connect();
    try {
      const { parent } = req.query;
      
      if (!parent) {
        return res.status(400).json({
          success: false,
          message: 'Le paramètre parent est requis'
        });
      }

      // Get niveau_6 that have id_niv_3 but id_niv_4 IS NULL AND id_niv_5 IS NULL
      const query = `
        SELECT 
          n6.id_niveau_6,
          n6.niveau_6,
          n6.id_niv_5,
          n6.id_niv_4,
          n6.id_niv_3,
          COUNT(DISTINCT a."ID") as child_count
        FROM niveau_6 n6
        LEFT JOIN articles a ON a."id_niv_6" = n6.id_niveau_6
        WHERE n6.id_niv_3 = $1 AND n6.id_niv_4 IS NULL AND n6.id_niv_5 IS NULL
        GROUP BY n6.id_niveau_6, n6.niveau_6, n6.id_niv_5, n6.id_niv_4, n6.id_niv_3
        ORDER BY n6.niveau_6
      `;
      
      const result = await client.query(query, [parent]);
      
      res.json({
        success: true,
        data: result.rows,
        count: result.rows.length
      });
    } catch (error) {
      console.error('Error fetching niveau 6 by niveau 3:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des données niveau 6',
        error: error.message
      });
    } finally {
      client.release();
    }
  }

  /**
   * Get articles by niveau_6 id
   */
  static async getArticles(req, res) {
    const client = await pool.connect();
    try {
      const { niveau6 } = req.query;
      
      if (!niveau6) {
        return res.status(400).json({
          success: false,
          message: 'Le paramètre niveau6 est requis'
        });
      }

      const query = `
        SELECT 
          a."ID",
          a."nom_article",
          a."Unite",
          a."PU"
        FROM articles a
        WHERE a."id_niv_6" = $1
        ORDER BY a."nom_article"
      `;
      
      const result = await client.query(query, [niveau6]);
      
      res.json({
        success: true,
        data: result.rows,
        count: result.rows.length
      });
    } catch (error) {
      console.error('Error fetching articles:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des articles',
        error: error.message
      });
    } finally {
      client.release();
    }
  }
}

module.exports = ReferentielController;

