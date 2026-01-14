const pool = require('../../config/db');
const EventNotificationService = require('../services/EventNotificationService');
const DesignationHelper = require('../utils/designationHelper');
const Project = require('./Project');

/**
 * ✅ CRITICAL FIX: Enhanced GBloc model with comprehensive validation and transaction safety
 */
class Gbloc {
    /**
     * Update a grand bloc with comprehensive validation and transaction safety
     */
    static async update(gblocId, updateData, userId, projectId = null) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // ✅ CRITICAL FIX: Lock the ouvrage to prevent concurrent modifications
            await client.query('SELECT id FROM ouvrage WHERE id = $1 FOR UPDATE', [gblocId]);

            // Get current ouvrage data
            const currentResult = await client.query('SELECT * FROM ouvrage WHERE id = $1', [gblocId]);
            if (currentResult.rows.length === 0) {
                throw new Error('Ouvrage not found');
            }
            const current = currentResult.rows[0];

            const { nom_ouvrage, prix_total, designation } = updateData;

            // ✅ CRITICAL FIX: Validate name uniqueness if being changed
            if (nom_ouvrage && nom_ouvrage !== current.nom_ouvrage) {
                try {
                    const nameConflict = await client.query(`
                        SELECT COUNT(*) as count
                        FROM ouvrage o
                        INNER JOIN structure s ON s.ouvrage = o.id
                        INNER JOIN projet_article pa ON pa.structure = s.id_structure
                        INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                        WHERE pl.id_projet = $1 AND o.nom_ouvrage = $2 AND o.id != $3
                    `, [projectId, nom_ouvrage, gblocId]);

                    if (parseInt(nameConflict.rows[0].count) > 0) {
                        throw new Error(`Un ouvrage nommé "${nom_ouvrage}" existe déjà dans ce projet.`);
                    }
                } catch (validationError) {
                    // If it's our custom error, rethrow it
                    if (validationError.message.includes('existe déjà')) {
                        throw validationError;
                    }
                    // Otherwise, log but continue (validation query might fail if no articles exist yet)
                }
            }

            // Build dynamic UPDATE query to only update provided fields
            const setClauses = [];
            const params = [];
            let paramIndex = 1;

            if (nom_ouvrage !== undefined) {
                setClauses.push(`nom_ouvrage = $${paramIndex}`);
                params.push(nom_ouvrage);
                paramIndex++;
            }
            if (prix_total !== undefined) {
                setClauses.push(`prix_total = $${paramIndex}`);
                params.push(prix_total);
                paramIndex++;
            }
            if (designation !== undefined) {
                setClauses.push(`designation = $${paramIndex}`);
                params.push(designation);
                paramIndex++;
            }

            // If no fields to update, return current data
            if (setClauses.length === 0) {
                await client.query('COMMIT');
                return current;
            }

            const updateSql = `
                UPDATE ouvrage SET
                    ${setClauses.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING *
            `;

            params.push(gblocId);
            const result = await client.query(updateSql, params);

            // CRITICAL: Commit the transaction BEFORE optional operations
            await client.query('COMMIT');

            // Optional: Recalculate designations (non-blocking)
            if (projectId && designation !== undefined && designation !== current.designation) {
                try {
                    // Reconnect to database for this operation
                    const recalcClient = await pool.connect();
                    try {
                        await DesignationHelper.recalculateProjectDesignations(projectId, recalcClient, null, gblocId);
                    } finally {
                        recalcClient.release();
                    }
                } catch (recalcError) {
                    console.error('Failed to recalculate designations after ouvrage update:', recalcError);
                }
            }

            // Optional: Create event (non-blocking)
            if (result.rows.length > 0 && userId && projectId) {
                const changes = {};
                let oldName = null;
                if (nom_ouvrage !== undefined && nom_ouvrage !== current.nom_ouvrage) {
                    changes.nom_ouvrage = nom_ouvrage;
                    oldName = current.nom_ouvrage;
                }
                if (prix_total !== undefined && prix_total !== current.prix_total) changes.prix_total = { from: current.prix_total, to: prix_total };
                if (designation !== undefined && designation !== current.designation) {
                    changes.designation = { from: current.designation, to: designation };
                }

                if (Object.keys(changes).length > 0) {
                    try {
                        await EventNotificationService.gblocUpdated(projectId, gblocId, userId, changes, oldName);
                    } catch (eventError) {
                        console.error('Failed to create gbloc update event:', eventError);
                    }
                }
            }

            return result.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Delete a grand bloc with comprehensive cleanup and transaction safety
     */
    static async delete(gblocId, userId, projectId = null) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // ✅ CRITICAL FIX: Lock the ouvrage to prevent concurrent modifications
            await client.query('SELECT id FROM ouvrage WHERE id = $1 FOR UPDATE', [gblocId]);

            // Verify access if projectId is provided
            if (projectId && userId) {
                const accessCheckSql = `
                    SELECT p.id
                    FROM projets p
                    LEFT JOIN projet_equipe pe ON pe.projet = p.id AND pe.equipe = $2
                    WHERE p.id = $1 AND (p."Ajouté_par" = $2 OR pe.id IS NOT NULL)
                `;
                const access = await client.query(accessCheckSql, [projectId, userId]);
                if (access.rows.length === 0) {
                    throw new Error('Project not found or access denied');
                }
            } else if (!projectId) {
                throw new Error('Project ID is required for gbloc deletion');
            }

            // Check if ouvrage exists first (like in old route)
            const ouvrageCheck = await client.query('SELECT id, nom_ouvrage FROM ouvrage WHERE id = $1', [gblocId]);
            if (ouvrageCheck.rows.length === 0) {
                throw new Error('Ouvrage not found');
            }
            const ouvrageName = ouvrageCheck.rows[0]?.nom_ouvrage;

            console.log(`[OUVRAGE DELETE] Attempting to delete ouvrage ${gblocId} from project ${projectId}`);

            // ✅ CRITICAL FIX: Lock related projet_article rows to prevent concurrent modifications
            await client.query(`
                SELECT id FROM projet_article 
                WHERE projet = $1 AND ouvrage = $2 
                FOR UPDATE
            `, [projectId, gblocId]);

            // IMPORTANT: Preserve event references by setting ouvrage to NULL before deletion
            // This ensures events remain with their preserved ouvrage_nom_anc intact
            const preserveEventsResult = await client.query(
                'UPDATE events SET ouvrage = NULL WHERE ouvrage = $1',
                [gblocId]
            );
            console.log(`[OUVRAGE DELETE] Preserved ${preserveEventsResult.rowCount} events by setting ouvrage to NULL`);

            // ✅ CRITICAL FIX: Get all blocs that will be affected before deletion
            const affectedBlocs = await client.query(`
                SELECT DISTINCT bloc FROM projet_article 
                WHERE projet = $1 AND ouvrage = $2 AND bloc IS NOT NULL
            `, [projectId, gblocId]);

            // Delete all projet_article rows linked to this ouvrage for the project
            const deleteArticlesResult = await client.query('DELETE FROM projet_article WHERE projet = $1 AND ouvrage = $2', [projectId, gblocId]);
            console.log(`[OUVRAGE DELETE] Deleted ${deleteArticlesResult.rowCount} projet_article entries for ouvrage ${gblocId} in project ${projectId}`);

            // ✅ CRITICAL FIX: Delete orphan blocs ONLY within this project scope (performance optimization)
            // Only delete blocs that are no longer referenced in ANY projet_article row
            const deleteOrphanBlocsResult = await client.query(`
                DELETE FROM bloc b 
                WHERE b.id IN (
                    SELECT DISTINCT pa_deleted.bloc 
                    FROM (SELECT bloc FROM projet_article WHERE projet = $1 AND ouvrage = $2) pa_deleted
                    WHERE NOT EXISTS (
                        SELECT 1 FROM projet_article pa_other 
                        WHERE pa_other.bloc = pa_deleted.bloc
                    )
                )
            `, [projectId, gblocId]);
            console.log(`[OUVRAGE DELETE] Deleted ${deleteOrphanBlocsResult.rowCount} orphan blocs in project scope`);

            // Delete ouvrage
            const result = await client.query('DELETE FROM ouvrage WHERE id = $1 RETURNING id', [gblocId]);
            console.log(`[GBLOC DELETE] Gbloc deletion result: ${result.rowCount} rows affected, returning: ${result.rows.length > 0}`);

            // Create event and notifications synchronously (before commit to ensure it's saved)
            if (result.rows.length > 0 && userId && projectId && ouvrageName) {
                try {
                    await EventNotificationService.gblocDeleted(projectId, gblocId, userId, ouvrageName);
                    console.log('✅ Ouvrage deletion event created successfully');
                } catch (eventError) {
                    console.error('❌ Failed to create ouvrage deletion event:', eventError);
                    // Don't throw - the ouvrage was deleted successfully
                }
            }

            await client.query('COMMIT');
            
            // Recalculate project price AFTER transaction is committed
            if (projectId && result.rows.length > 0) {
                try {
                    await Project.recalculatePrixVente(projectId);
                    console.log(`✅ Recalculated prix_vente after deleting ouvrage ${gblocId} from project ${projectId}`);
                } catch (recalcError) {
                    console.error(`❌ Failed to recalculate prix_vente after deleting ouvrage ${gblocId}:`, recalcError);
                    // Don't throw - the ouvrage was deleted successfully
                }
            }
            
            return result.rows.length > 0;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get gbloc by ID
     */
    static async findById(gblocId) {
        const query = 'SELECT * FROM ouvrage WHERE id = $1';
        const result = await pool.query(query, [gblocId]);
        return result.rows[0] || null;
    }

    /**
     * Get ouvrages for a project
     */
    static async findByProject(projectId) {
        const query = `
            SELECT DISTINCT o.*, pl.id_lot as lot
            FROM ouvrage o
            INNER JOIN structure s ON s.ouvrage = o.id
            INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
            INNER JOIN projet_article pa ON pa.structure = s.id_structure
            WHERE pl.id_projet = $1
            ORDER BY o.nom_ouvrage
        `;
        const result = await pool.query(query, [projectId]);
        return result.rows;
    }

    /**
     * Recalculate and update gbloc prix_total based on articles
     */
    static async recalculatePrixTotal(gblocId, projectId, client = null) {
        const shouldReleaseClient = !client;
        if (!client) {
            client = await pool.connect();
        }

        try {
            // Calculate total TTC from all articles in this ouvrage
            const totalQuery = `
                SELECT COALESCE(SUM(pa.total_ttc), 0)::float AS total_ttc 
                FROM projet_article pa
                INNER JOIN structure s ON s.id_structure = pa.structure
                INNER JOIN ouvrage o ON o.id = s.ouvrage
                INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                WHERE pl.id_projet = $1 AND s.ouvrage = $2
            `;
            const totalResult = await client.query(totalQuery, [projectId, gblocId]);
            const newTotal = totalResult.rows[0]?.total_ttc || 0;

            // Update ouvrage prix_total
            const updateQuery = 'UPDATE ouvrage SET prix_total = $1 WHERE id = $2';
            await client.query(updateQuery, [newTotal, gblocId]);

            return newTotal;
        } finally {
            if (shouldReleaseClient) {
                client.release();
            }
        }
    }

    /**
     * Recalculate prix_total for all gblocs in a project
     */
    static async recalculateAllPrixTotals(projectId, client = null) {
        const shouldReleaseClient = !client;
        if (!client) {
            client = await pool.connect();
        }

        try {
            // Get all ouvrages for this project
            const ouvragesQuery = `
                SELECT DISTINCT s.ouvrage as id 
                FROM projet_article pa
                INNER JOIN structure s ON s.id_structure = pa.structure
                INNER JOIN ouvrage o ON o.id = s.ouvrage
                INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                WHERE pl.id_projet = $1 AND s.ouvrage IS NOT NULL
            `;
            const ouvragesResult = await client.query(ouvragesQuery, [projectId]);

            // Recalculate each ouvrage
            for (const row of ouvragesResult.rows) {
                await this.recalculatePrixTotal(row.id, projectId, client);
            }
        } finally {
            if (shouldReleaseClient) {
                client.release();
            }
        }
    }
}

module.exports = Gbloc;
