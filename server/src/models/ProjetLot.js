const pool = require('../../config/db');

class ProjetLot {
    /**
     * Find or create a link between a project and a lot (niveau_2)
     * @param {number} projectId 
     * @param {number} lotId - ID from niveau_2 table
     * @param {object} client - Optional DB client
     * @returns {Promise<number>} id_projet_lot
     */
    static async findOrCreate(projectId, lotId, client = null) {
        const dbClient = client || await pool.connect();
        const shouldRelease = !client;
        try {
            // Check if exists
            const res = await dbClient.query(
                'SELECT id_projet_lot FROM projet_lot WHERE id_projet = $1 AND id_lot = $2',
                [projectId, lotId]
            );
            if (res.rows.length > 0) {
                return res.rows[0].id_projet_lot;
            }

            // Create
            // Calculate sequential lot number for this project
            const lotCountResult = await dbClient.query(
                'SELECT COUNT(*) as count FROM projet_lot WHERE id_projet = $1',
                [projectId]
            );
            const nextLotNumber = parseInt(lotCountResult.rows[0].count || 0) + 1;
            const designationLot = `Lot ${nextLotNumber}:`;

            const seqCheck = await dbClient.query("SELECT to_regclass('projet_lot_id_projet_lot_seq') as seq");
            let nextId;
            if (seqCheck.rows[0]?.seq) {
                const sequenceResult = await dbClient.query("SELECT nextval('projet_lot_id_projet_lot_seq')");
                nextId = sequenceResult.rows[0].nextval;
            } else {
                const maxIdResult = await dbClient.query('SELECT COALESCE(MAX(id_projet_lot), 0) + 1 as next_id FROM projet_lot');
                nextId = maxIdResult.rows[0].next_id;
            }

            const insert = await dbClient.query(
                'INSERT INTO projet_lot (id_projet_lot, id_projet, id_lot, designation_lot) VALUES ($1, $2, $3, $4) RETURNING id_projet_lot',
                [nextId, projectId, lotId, designationLot]
            );
            return insert.rows[0].id_projet_lot;
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
                'SELECT * FROM projet_lot WHERE id_projet_lot = $1',
                [id]
            );
            return res.rows[0] || null;
        } finally {
            if (shouldRelease) dbClient.release();
        }
    }

    /**
     * Get all lots for a project
     */
    static async findByProject(projectId, client = null) {
        const dbClient = client || await pool.connect();
        const shouldRelease = !client;
        try {
            const res = await dbClient.query(`
                SELECT pl.id_projet_lot, pl.id_lot, n2.niveau_2 as lot_name
                FROM projet_lot pl
                JOIN niveau_2 n2 ON pl.id_lot = n2.id_niveau_2
                WHERE pl.id_projet = $1
                ORDER BY n2.niveau_2
            `, [projectId]);
            return res.rows;
        } finally {
            if (shouldRelease) dbClient.release();
        }
    }
}

module.exports = ProjetLot;
