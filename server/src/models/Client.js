const pool = require('../../config/db');

class Client {
    /**
     * Get all clients with pagination and search
     */
    static async findAll({ search = '', page = 1, limit = 100 }) {
        const offset = (page - 1) * limit;
        
        const params = [];
        const conditions = [];

        // Search filter
        if (search) {
            conditions.push(`nom_client ILIKE $${params.length + 1}`);
            params.push(`%${search}%`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const query = `
            SELECT 
                id,
                nom_client,
                agence,
                responsable,
                marge_brut,
                marge_net,
                effectif_chantier,
                (SELECT COUNT(*) FROM projets WHERE client = client.id) as projets_count
            FROM client
            ${whereClause}
            ORDER BY nom_client ASC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;
        
        params.push(limit, offset);

        const result = await pool.query(query, params);
        return result.rows;
    }

    /**
     * Get client by ID
     */
    static async findById(clientId) {
        const query = `
            SELECT 
                id,
                nom_client,
                agence,
                responsable,
                marge_brut,
                marge_net,
                effectif_chantier,
                (SELECT COUNT(*) FROM projets WHERE client = client.id) as projets_count
            FROM client
            WHERE id = $1
        `;
        const result = await pool.query(query, [clientId]);
        return result.rows[0] || null;
    }

    /**
     * Find client by name (case-insensitive)
     */
    static async findByName(nom_client, excludeId = null) {
        const params = [nom_client];
        let query = `
            SELECT 
                id,
                nom_client,
                agence,
                responsable,
                marge_brut,
                marge_net,
                effectif_chantier
            FROM client
            WHERE LOWER(nom_client) = LOWER($1)
        `;
        
        if (excludeId !== null) {
            query += ` AND id != $2`;
            params.push(excludeId);
        }
        
        const result = await pool.query(query, params);
        return result.rows[0] || null;
    }

    /**
     * Create a new client
     */
    static async create(clientData) {
        const {
            nom_client,
            agence,
            responsable,
            marge_brut,
            marge_net,
            effectif_chantier
        } = clientData;

        if (!nom_client || nom_client.trim() === '') {
            throw new Error('Le nom du client est requis');
        }

        // Check if client table has auto-incrementing ID
        const clientIdCheck = await pool.query(`
            SELECT column_default FROM information_schema.columns 
            WHERE table_name = 'client' AND column_name = 'id'
        `);

        let query, values;

        if (clientIdCheck.rows[0]?.column_default) {
            // ID has default value (auto-increment)
            query = `
                INSERT INTO client (
                    nom_client,
                    agence,
                    responsable,
                    marge_brut,
                    marge_net,
                    effectif_chantier
                ) VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *
            `;
            values = [
                nom_client,
                agence || null,
                responsable || null,
                marge_brut || null,
                marge_net || null,
                effectif_chantier || null
            ];
        } else {
            // ID doesn't have default, generate manually
            const maxIdResult = await pool.query('SELECT COALESCE(MAX(id), 0) as max_id FROM client');
            const nextId = maxIdResult.rows[0].max_id + 1;
            
            query = `
                INSERT INTO client (
                    id,
                    nom_client,
                    agence,
                    responsable,
                    marge_brut,
                    marge_net,
                    effectif_chantier
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `;
            values = [
                nextId,
                nom_client,
                agence || null,
                responsable || null,
                marge_brut || null,
                marge_net || null,
                effectif_chantier || null
            ];
        }

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    /**
     * Update client
     */
    static async update(clientId, clientData) {
        const {
            nom_client,
            agence,
            responsable,
            marge_brut,
            marge_net,
            effectif_chantier
        } = clientData;

        const query = `
            UPDATE client SET
                nom_client = COALESCE($1, nom_client),
                agence = COALESCE($2, agence),
                responsable = COALESCE($3, responsable),
                marge_brut = COALESCE($4, marge_brut),
                marge_net = COALESCE($5, marge_net),
                effectif_chantier = COALESCE($6, effectif_chantier)
            WHERE id = $7
            RETURNING *
        `;

        const values = [
            nom_client,
            agence,
            responsable,
            marge_brut,
            marge_net,
            effectif_chantier,
            clientId
        ];

        const result = await pool.query(query, values);
        return result.rows[0] || null;
    }

    /**
     * Delete client
     */
    static async delete(clientId) {
        // Check if client is used in any projects
        const checkQuery = `
            SELECT COUNT(*) as count FROM projets WHERE client = $1
        `;
        const checkResult = await pool.query(checkQuery, [clientId]);
        
        if (checkResult.rows[0].count > 0) {
            throw new Error('Cannot delete client: it is associated with existing projects');
        }

        const query = `DELETE FROM client WHERE id = $1`;
        await pool.query(query, [clientId]);
        return true;
    }

    /**
     * Get count of total clients
     */
    static async count({ search = '' }) {
        const params = [];
        const conditions = [];

        if (search) {
            conditions.push(`nom_client ILIKE $${params.length + 1}`);
            params.push(`%${search}%`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const query = `SELECT COUNT(*) as total FROM client ${whereClause}`;
        const result = await pool.query(query, params);
        return parseInt(result.rows[0].total, 10);
    }
}

module.exports = Client;
