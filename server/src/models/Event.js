const pool = require('../../config/db');
const { buildLotNameSelect, ensureLotId } = require('../utils/lotHelper');

// Custom LOT_JOIN for events table - uses direct lot column
const LOT_JOIN = 'LEFT JOIN niveau_2 lot_niv2 ON lot_niv2.id_niveau_2 = e.lot';
const LOT_NAME_SELECT = buildLotNameSelect('lot_niv2');

class Event {
    /**
     * Create a new event
     */
    static async create({ action, metadata = {}, lot = null, userId, projectId, articleId = null, blocId = null, gblocId = null, blocNom = null, gblocNom = null }) {
        console.log('🔍 Event.create called:', { action, lot, userId, projectId, articleId, blocId, gblocId });
        // Try to use sequence first, fallback to MAX if sequence doesn't exist
        let nextId;
        try {
            const seqResult = await pool.query('SELECT nextval(\'events_id_seq\') as next_id');
            nextId = seqResult.rows[0].next_id;
        } catch (seqError) {
            // Fallback to MAX if sequence doesn't exist (backward compatibility)
            const maxIdResult = await pool.query('SELECT COALESCE(MAX(id_event), 0) + 1 as next_id FROM events');
            nextId = maxIdResult.rows[0].next_id;
        }


        // Resolve lot name to lot ID if lot is provided as a string
        let lotId = null;
        if (lot !== null && lot !== undefined) {
            // If lot is already a number, use it directly
            if (typeof lot === 'number') {
                lotId = lot;
                console.log('🔍 Using lot ID directly:', lotId);
            } else {
                // If lot is a string (name), try to resolve it to ID
                try {
                    console.log('🔍 Resolving lot name to ID:', lot);
                    lotId = await ensureLotId(null, lot, { allowInsert: false });
                    console.log('✅ Resolved lotId:', lotId);
                } catch (error) {
                    console.warn('⚠️ Failed to resolve lot ID for event:', error.message);
                    // Continue with null lot if resolution fails
                    lotId = null;
                }
            }
        }


        const query = `
            INSERT INTO events (id_event, action, created_at, metadata, "user", projet, lot, article, bloc, ouvrage, bloc_nom_anc, ouvrage_nom_anc)
            VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id_event, action, created_at, metadata, "user", projet, lot, article, bloc, ouvrage, bloc_nom_anc, ouvrage_nom_anc
        `;


        const values = [
            nextId,
            action,
            JSON.stringify(metadata),
            userId,
            projectId,      // Direct projet reference
            lotId,          // Direct lot reference
            articleId,
            blocId,
            gblocId,
            blocNom,
            gblocNom
        ];

        console.log('🔍 Inserting event with values:', values);

        try {
            const result = await pool.query(query, values);
            console.log('✅ Event created successfully:', result.rows[0]);
            return result.rows[0];
        } catch (error) {
            console.error('❌ Failed to insert event:', error);
            throw error;
        }
    }

    /**
     * Get events for a project.
     * Note: Actual retention is enforced by deleteOlderThan (default 60 days),
     * so we no longer hard‑limit this to the last 5 minutes here.
     */
    static async findByProject(projectId, { limit = 50, offset = 0 } = {}) {
        const query = `
            SELECT 
                e.id_event,
                e.action,
                e.created_at,
                e.metadata,
                ${LOT_NAME_SELECT},
                e.projet as project_id,
                e.lot as lot_id,
                e.article as article_id,
                e.bloc as bloc_id,
                e.ouvrage as gbloc_id,
                e.bloc_nom_anc as bloc_nom,
                e.ouvrage_nom_anc as gbloc_nom,
                u.nom_utilisateur as user_name,
                u.email as user_email,
                p."Nom_Projet" as project_name,
                b.nom_bloc,
                o.nom_ouvrage as nom_gbloc
            FROM events e
            ${LOT_JOIN}
            LEFT JOIN users u ON e."user" = u.id
            LEFT JOIN projets p ON e.projet = p.id
            LEFT JOIN bloc b ON e.bloc = b.id
            LEFT JOIN ouvrage o ON e.ouvrage = o.id
            WHERE e.projet = $1
            ORDER BY e.created_at DESC
            LIMIT $2 OFFSET $3
        `;

        const result = await pool.query(query, [projectId, limit, offset]);
        return result.rows.map(row => {
            const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
            // Use stored bloc_nom/gbloc_nom first, fallback to joined values
            const finalBlocNom = row.bloc_nom || row.nom_bloc;
            const finalGblocNom = row.gbloc_nom || row.nom_gbloc;

            // Enrich metadata with bloc/gbloc names
            if (finalBlocNom && !metadata.bloc_nom) {
                metadata.bloc_nom = finalBlocNom;
            }
            if (finalGblocNom && !metadata.gbloc_name) {
                metadata.gbloc_name = finalGblocNom;
            }
            // Ensure lot_name present for frontend rendering
            if (row.lot_name && !metadata.lot_name) {
                metadata.lot_name = row.lot_name;
            }
            return {
                ...row,
                metadata,
                bloc_nom: finalBlocNom,
                gbloc_nom: finalGblocNom,
                lot_name: row.lot_name || null // Ensure lot_name is available as top-level field
            };
        });
    }

    /**
     * Get recent events for a project within a rolling window (default 5 minutes)
     */
    static async findRecentByProject(projectId, minutes = 5) {
        const query = `
            SELECT 
                e.id_event,
                e.action,
                e.created_at,
                e.metadata,
                ${LOT_NAME_SELECT},
                e.projet as project_id,
                e.lot as lot_id,
                e.article as article_id,
                e.bloc as bloc_id,
                e.ouvrage as gbloc_id,
                e.bloc_nom_anc as bloc_nom,
                e.ouvrage_nom_anc as gbloc_nom,
                u.nom_utilisateur as user_name,
                u.email as user_email,
                p."Nom_Projet" as project_name,
                b.nom_bloc,
                o.nom_ouvrage as nom_gbloc
            FROM events e
            ${LOT_JOIN}
            LEFT JOIN users u ON e."user" = u.id
            LEFT JOIN projets p ON e.projet = p.id
            LEFT JOIN bloc b ON e.bloc = b.id
            LEFT JOIN ouvrage o ON e.ouvrage = o.id
            WHERE e.projet = $1
        `;

        const result = await pool.query(query, [projectId]);
        return result.rows.map(row => {
            const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
            // Use stored bloc_nom/gbloc_nom first, fallback to joined values
            const finalBlocNom = row.bloc_nom || row.nom_bloc;
            const finalGblocNom = row.gbloc_nom || row.nom_gbloc;

            // Enrich metadata with bloc/gbloc names
            if (finalBlocNom && !metadata.bloc_nom) {
                metadata.bloc_nom = finalBlocNom;
            }
            if (finalGblocNom && !metadata.gbloc_name) {
                metadata.gbloc_name = finalGblocNom;
            }
            // Ensure lot_name present for frontend rendering
            if (row.lot_name && !metadata.lot_name) {
                metadata.lot_name = row.lot_name;
            }
            return {
                ...row,
                metadata,
                bloc_nom: finalBlocNom,
                gbloc_nom: finalGblocNom,
                lot_name: row.lot_name || null // Ensure lot_name is available as top-level field
            };
        });
    }

    /**
     * Get event by ID
     */
    static async findById(eventId) {
        const query = `
            SELECT 
                e.id_event,
                e.action,
                e.created_at,
                e.metadata,
                ${LOT_NAME_SELECT},
                e.projet as project_id,
                e.article as article_id,
                e.bloc as bloc_id,
                e.ouvrage as gbloc_id,
                e.bloc_nom_anc as bloc_nom,
                e.ouvrage_nom_anc as gbloc_nom,
                u.nom_utilisateur as user_name,
                u.email as user_email,
                p."Nom_Projet" as project_name,
                b.nom_bloc,
                o.nom_ouvrage as nom_gbloc
            FROM events e
            ${LOT_JOIN}
            LEFT JOIN users u ON e."user" = u.id
            LEFT JOIN projets p ON e.projet = p.id
            LEFT JOIN bloc b ON e.bloc = b.id
            LEFT JOIN ouvrage o ON e.ouvrage = o.id
            WHERE e.id_event = $1
        `;

        const result = await pool.query(query, [eventId]);
        if (result.rows.length === 0) return null;

        const row = result.rows[0];
        const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
        // Use stored bloc_nom/gbloc_nom first, fallback to joined values
        const finalBlocNom = row.bloc_nom || row.nom_bloc;
        const finalGblocNom = row.gbloc_nom || row.nom_gbloc;

        // Enrich metadata with bloc/gbloc names
        if (finalBlocNom && !metadata.bloc_nom) {
            metadata.bloc_nom = finalBlocNom;
        }
        if (finalGblocNom && !metadata.gbloc_name) {
            metadata.gbloc_name = finalGblocNom;
        }
        // Ensure lot_name present for frontend rendering
        if (row.lot_name && !metadata.lot_name) {
            metadata.lot_name = row.lot_name;
        }
        return {
            ...row,
            metadata,
            lot_name: row.lot_name || null, // Ensure lot_name is available as top-level field
            bloc_nom: finalBlocNom,
            gbloc_nom: finalGblocNom
        };
    }

    /**
     * Get bloc and gbloc names for event creation
     * Preserves names even if bloc/gbloc are deleted
     */
    static async getBlocAndGblocNames(blocId = null, gblocId = null) {
        const names = { bloc_nom: null, gbloc_nom: null };

        if (blocId) {
            try {
                const blocResult = await pool.query(
                    'SELECT nom_bloc FROM bloc WHERE id = $1',
                    [blocId]
                );
                if (blocResult.rows.length > 0) {
                    names.bloc_nom = blocResult.rows[0].nom_bloc;
                }
            } catch (error) {
                console.warn('Error fetching bloc name:', error.message);
            }
        }

        if (gblocId) {
            try {
                const ouvrageResult = await pool.query(
                    'SELECT nom_ouvrage FROM ouvrage WHERE id = $1',
                    [gblocId]
                );
                if (ouvrageResult.rows.length > 0) {
                    names.gbloc_nom = ouvrageResult.rows[0].nom_ouvrage;
                }
            } catch (error) {
                console.warn('Error fetching gbloc name:', error.message);
            }
        }

        return names;
    }

    /**
     * Create event with automatic bloc/gbloc name resolution
     */
    static async createWithNames({
        action,
        metadata = {},
        lot = null,
        userId,
        projectId,
        articleId = null,
        blocId = null,
        gblocId = null,
        blocNom = null,
        gblocNom = null
    }) {
        // If blocNom/gblocNom are provided (e.g., for deletion events), use them directly
        // Otherwise, fetch them from the database
        let finalBlocNom = blocNom;
        let finalGblocNom = gblocNom;

        // Fetch missing names from database
        if ((blocId && !finalBlocNom) || (gblocId && !finalGblocNom)) {
            const names = await this.getBlocAndGblocNames(blocId, gblocId);
            if (!finalBlocNom) finalBlocNom = names.bloc_nom;
            if (!finalGblocNom) finalGblocNom = names.gbloc_nom;
        }

        return await this.create({
            action,
            metadata,
            lot,
            userId,
            projectId,
            articleId,
            blocId,
            gblocId,
            blocNom: finalBlocNom,
            gblocNom: finalGblocNom
        });
    }

    /**
     * Delete old events (cleanup)
     * @param {number} minutes - Retention in minutes (default 60 days / 86400 minutes)
     */
    static async deleteOlderThan(minutes = 60 * 24 * 60) {
        const query = `
            DELETE FROM events
            WHERE created_at < NOW() - INTERVAL '${minutes} minutes'
            RETURNING id_event
        `;

        const result = await pool.query(query);
        return result.rows.length;
    }
}

module.exports = Event;

