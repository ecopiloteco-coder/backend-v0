const pool = require('../../config/db');

class Structure {
    /**
     * Find or create a structure (Ouvrage + Bloc combination)
     * @param {number} ouvrageId - ID from ouvrage table
     * @param {number|null} blocId - ID from bloc table (nullable)
     * @param {object} client - Optional DB client
     * @returns {Promise<number>} id_structure
     */
    static async findOrCreate(ouvrageId, blocId, client = null) {
        const dbClient = client || await pool.connect();
        const shouldRelease = !client;
        try {
            // Check if exists
            let query = 'SELECT id_structure FROM structure WHERE ouvrage = $1';
            let params = [ouvrageId];

            if (blocId) {
                query += ' AND bloc = $2';
                params.push(blocId);
            } else {
                query += ' AND bloc IS NULL';
            }

            const res = await dbClient.query(query, params);
            if (res.rows.length > 0) {
                return res.rows[0].id_structure;
            }

            // Create with appropriate action
            const action = blocId ? 'bloc' : 'ouvrage';

            // Check if id_structure has auto-increment
            const idCheck = await dbClient.query(`
                SELECT column_default FROM information_schema.columns 
                WHERE table_name='structure' AND column_name='id_structure'
            `);

            let insert;
            if (idCheck.rows[0]?.column_default) {
                // Auto-increment available
                insert = await dbClient.query(
                    'INSERT INTO structure (ouvrage, bloc, action) VALUES ($1, $2, $3) RETURNING id_structure',
                    [ouvrageId, blocId || null, action]
                );
            } else {
                // Manual ID generation needed
                const maxId = await dbClient.query('SELECT COALESCE(MAX(id_structure), 0) as max_id FROM structure');
                const nextId = maxId.rows[0].max_id + 1;
                insert = await dbClient.query(
                    'INSERT INTO structure (id_structure, ouvrage, bloc, action) VALUES ($1, $2, $3, $4) RETURNING id_structure',
                    [nextId, ouvrageId, blocId || null, action]
                );
            }

            return insert.rows[0].id_structure;
        } finally {
            if (shouldRelease) dbClient.release();
        }
    }

    /**
     * Find by ID
     */
    static async findById(id, client = null) {
        const dbClient = client || await pool.connect();
        const shouldRelease = !client;
        try {
            const res = await dbClient.query(
                'SELECT * FROM structure WHERE id_structure = $1',
                [id]
            );
            return res.rows[0] || null;
        } finally {
            if (shouldRelease) dbClient.release();
        }
    }

    /**
     * Update existing structures with NULL action values
     * Sets action based on whether bloc is NULL or not
     */
    static async updateNullActions(client = null) {
        const dbClient = client || await pool.connect();
        const shouldRelease = !client;
        try {
            const result = await dbClient.query(`
                UPDATE structure 
                SET action = CASE 
                    WHEN bloc IS NULL THEN 'ouvrage'
                    ELSE 'bloc'
                END
                WHERE action IS NULL
                RETURNING id_structure, action
            `);
            return result.rows.length;
        } finally {
            if (shouldRelease) dbClient.release();
        }
    }
}

module.exports = Structure;
