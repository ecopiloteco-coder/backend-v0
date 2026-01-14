const pool = require('../../config/db');

class Fournisseur {
    /**
     * Get all fournisseurs with pagination and search
     */
    static async findAll({ search = '', page = 1, limit = 100, type = '' }) {
        const offset = (page - 1) * limit;
        
        const params = [];
        const conditions = [];

        // Search filter
        if (search) {
            conditions.push(`(nom_fournisseur ILIKE $${params.length + 1} OR type ILIKE $${params.length + 1} OR categorie ILIKE $${params.length + 1})`);
            params.push(`%${search}%`);
        }

        // Type filter (accent/case-insensitive)
        if (type) {
            conditions.push(`unaccent(LOWER(type)) = unaccent(LOWER($${params.length + 1}))`);
            params.push(type);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const query = `
            SELECT 
                id_fournisseur,
                nom_fournisseur,
                type,
                categorie,
                adresse,
                telephone,
                email,
                "URL" AS url
            FROM fournisseur
            ${whereClause}
            ORDER BY nom_fournisseur ASC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;
        
        params.push(limit, offset);

        const result = await pool.query(query, params);
        return result.rows;
    }

    /**
     * Get fournisseur by ID
     */
    static async findById(fournisseurId) {
        const query = `
            SELECT 
                id_fournisseur,
                nom_fournisseur,
                type,
                categorie,
                adresse,
                telephone,
                email,
                "URL" AS url
            FROM fournisseur
            WHERE id_fournisseur = $1
        `;
        const result = await pool.query(query, [fournisseurId]);
        return result.rows[0] || null;
    }

    /**
     * Find fournisseur by name (case-insensitive)
     */
    static async findByName(nom_fournisseur, excludeId = null) {
        const params = [nom_fournisseur];
        let query = `
            SELECT 
                id_fournisseur,
                nom_fournisseur,
                type,
                categorie,
                adresse,
                telephone,
                email,
                "URL" AS url
            FROM fournisseur
            WHERE LOWER(nom_fournisseur) = LOWER($1)
        `;
        
        if (excludeId !== null) {
            query += ` AND id_fournisseur != $2`;
            params.push(excludeId);
        }
        
        const result = await pool.query(query, params);
        return result.rows[0] || null;
    }

    /**
     * Create a new fournisseur
     */
    static async create(fournisseurData) {
        const {
            nom_fournisseur,
            type,
            categorie,
            adresse,
            telephone,
            email,
            url
        } = fournisseurData;

        if (!nom_fournisseur || nom_fournisseur.trim() === '') {
            throw new Error('Le nom du fournisseur est requis');
        }

        if (!type || type.trim() === '') {
            throw new Error('Le type du fournisseur est requis');
        }

        if (!categorie || categorie.trim() === '') {
            throw new Error('La catégorie du fournisseur est requise');
        }

        // Check if fournisseur table has auto-incrementing ID
        const fournisseurIdCheck = await pool.query(`
            SELECT column_default FROM information_schema.columns 
            WHERE table_name = 'fournisseur' AND column_name = 'id_fournisseur'
        `);

        let query, values;

        if (fournisseurIdCheck.rows[0]?.column_default) {
            // ID has default value (auto-increment)
            query = `
                INSERT INTO fournisseur (
                    nom_fournisseur,
                    type,
                    categorie,
                    adresse,
                    telephone,
                    email,
                    "URL"
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `;
            values = [
                nom_fournisseur,
                type,
                categorie,
                adresse || null,
                telephone || null,
                email || null,
                url || null
            ];
        } else {
            // ID doesn't have default, generate manually
            const maxIdResult = await pool.query('SELECT COALESCE(MAX(id_fournisseur), 0) as max_id FROM fournisseur');
            const nextId = maxIdResult.rows[0].max_id + 1;
            
            query = `
                INSERT INTO fournisseur (
                    id_fournisseur,
                    nom_fournisseur,
                    type,
                    categorie,
                    adresse,
                    telephone,
                    email,
                    "URL"
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
            `;
            values = [
                nextId,
                nom_fournisseur,
                type,
                categorie,
                adresse || null,
                telephone || null,
                email || null,
                url || null
            ];
        }

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    /**
     * Update fournisseur
     */
    static async update(fournisseurId, fournisseurData) {
        const {
            nom_fournisseur,
            type,
            categorie,
            adresse,
            telephone,
            email,
            url
        } = fournisseurData;

        const query = `
            UPDATE fournisseur SET
                nom_fournisseur = COALESCE($1, nom_fournisseur),
                type = COALESCE($2, type),
                categorie = COALESCE($3, categorie),
                adresse = COALESCE($4, adresse),
                telephone = COALESCE($5, telephone),
                email = COALESCE($6, email),
                "URL" = COALESCE($7, "URL")
            WHERE id_fournisseur = $8
            RETURNING *
        `;

        const values = [
            nom_fournisseur,
            type,
            categorie,
            adresse,
            telephone,
            email,
            url,
            fournisseurId
        ];

        const result = await pool.query(query, values);
        return result.rows[0] || null;
    }

    /**
     * Delete fournisseur
     */
    static async delete(fournisseurId) {
        // Note: Add any foreign key constraint checks here if needed
        // For example, if fournisseurs are referenced in other tables
        
        const query = `DELETE FROM fournisseur WHERE id_fournisseur = $1`;
        await pool.query(query, [fournisseurId]);
        return true;
    }

    /**
     * Get count of total fournisseurs
     */
    static async count({ search = '', type = '' }) {
        const params = [];
        const conditions = [];

        if (search) {
            conditions.push(`(nom_fournisseur ILIKE $${params.length + 1} OR type ILIKE $${params.length + 1} OR categorie ILIKE $${params.length + 1})`);
            params.push(`%${search}%`);
        }

        if (type) {
            conditions.push(`type = $${params.length + 1}`);
            params.push(type);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const query = `SELECT COUNT(*) as total FROM fournisseur ${whereClause}`;
        const result = await pool.query(query, params);
        return parseInt(result.rows[0].total, 10);
    }
}

module.exports = Fournisseur;
