const pool = require('../../config/db');
const EventNotificationService = require('../services/EventNotificationService');
const { buildNormalizedArticlesSubquery } = require('../services/NiveauService');
const { ensureLotId } = require('../utils/lotHelper');
const Project = require('./Project');

class Lot {
    /**
     * Create a new lot
     */
    static async create(projectId, lotData, userId, gblocId = null) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Verify project access
            const projectCheck = await client.query('SELECT id FROM projets WHERE id = $1', [projectId]);
            if (projectCheck.rows.length === 0) {
                throw new Error('Project not found');
            }

            const { name, description = null, designation = null } = lotData;
            const lotLabel = typeof name === 'string' ? name.trim() : null;
            if (!lotLabel) {
                throw new Error('Lot name is required');
            }
            const lotId = await ensureLotId(client, lotLabel);
            if (!lotId) {
                throw new Error('Unable to resolve lot identifier');
            }

            // Check if lot already exists in project with the same gbloc association
            // Use the new schema with structure table
            let existingLotQuery, existingLotParams;

            if (gblocId === null) {
                // Only check lots with null ouvrage (directly under project)
                existingLotQuery = `
                    SELECT DISTINCT pa.id 
                    FROM projet_article pa
                    INNER JOIN structure s ON s.id_structure = pa.structure
                    INNER JOIN ouvrage o ON o.id = s.ouvrage
                    INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                    WHERE pl.id_projet = $1 AND pl.id_lot = $2 AND s.ouvrage IS NULL
                `;
                existingLotParams = [projectId, lotId];
            } else {
                // Only check lots with specific ouvrage
                existingLotQuery = `
                    SELECT DISTINCT pa.id 
                    FROM projet_article pa
                    INNER JOIN structure s ON s.id_structure = pa.structure
                    INNER JOIN ouvrage o ON o.id = s.ouvrage
                    INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                    WHERE pl.id_projet = $1 AND pl.id_lot = $2 AND s.ouvrage = $3
                `;
                existingLotParams = [projectId, lotId, gblocId];
            }

            const existingLot = await client.query(existingLotQuery, existingLotParams);

            if (existingLot.rows.length > 0) {
                throw new Error('Lot already exists in this project');
            }

            // ✅ ORGANIZED HIERARCHY: Create structure entry and projet_article for the lot
            // First create projet_lot entry to link project and lot
            // Calculate sequential lot number for this project
            const lotCountResult = await client.query(
                'SELECT COUNT(*) as count FROM projet_lot WHERE id_projet = $1',
                [projectId]
            );
            const nextLotNumber = parseInt(lotCountResult.rows[0].count || 0) + 1;
            const designationLot = `Lot ${nextLotNumber}:`;

            const seqCheck = await client.query("SELECT to_regclass('projet_lot_id_projet_lot_seq') as seq");
            let nextId;
            if (seqCheck.rows[0]?.seq) {
                const sequenceResult = await client.query("SELECT nextval('projet_lot_id_projet_lot_seq')");
                nextId = sequenceResult.rows[0].nextval;
            } else {
                const maxIdResult = await client.query('SELECT COALESCE(MAX(id_projet_lot), 0) + 1 as next_id FROM projet_lot');
                nextId = maxIdResult.rows[0].next_id;
            }

            const projetLotInsert = await client.query(
                `INSERT INTO projet_lot (id_projet_lot, id_projet, id_lot, designation_lot) VALUES ($1, $2, $3, $4) RETURNING id_projet_lot`,
                [nextId, projectId, lotId, designationLot]
            );
            const projetLotId = projetLotInsert.rows[0].id_projet_lot;




            // Create event and notifications
            try {
                console.log('🔔 Creating lot event:', { projectId, userId, lotName: name, gblocId });
                await EventNotificationService.lotCreated(projectId, userId, { name, description, gblocId });
                console.log('✅ Lot event created successfully');
            } catch (eventError) {
                console.error('❌ Failed to create lot creation event:', eventError);
                console.error('Error details:', eventError.stack);
            }

            await client.query('COMMIT');
            return { name, description };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Update lot name across project
     */
    static async update(projectId, oldLotName, newLotName, userId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const oldLotId = await ensureLotId(client, oldLotName, { allowInsert: false });
            if (!oldLotId) {
                throw new Error('Lot not found');
            }

            // Update the lot name in niveau_2 table
            const updateResult = await client.query(
                'UPDATE niveau_2 SET niveau_2 = $1 WHERE id_niveau_2 = $2 RETURNING id_niveau_2',
                [newLotName, oldLotId]
            );

            if (updateResult.rows.length === 0) {
                throw new Error('Failed to update lot name');
            }

            const result = updateResult;

            // Create event and notifications
            if (result.rows.length > 0 && userId) {
                try {
                    await EventNotificationService.lotUpdated(projectId, userId, oldLotName, {
                        name: { from: oldLotName, to: newLotName }
                    });
                } catch (eventError) {
                    console.error('Failed to create lot update event:', eventError);
                }
            }

            await client.query('COMMIT');
            return result.rows.length > 0;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Delete lot from project
     */
    static async delete(projectId, lotName, userId, gblocId = null) {
        const client = await pool.connect();
        let ouvrageDeleted = false;
        let deletedOuvrageId = null;
        let detachedOuvrageDeleted = false;
        let detachedOuvrageId = null;
        try {
            await client.query('BEGIN');

            // Determine the lot identifier for this name
            const lotId = await ensureLotId(client, lotName, { allowInsert: false });
            if (!lotId) {
                throw new Error('Lot not found');
            }

            // Get the bloc IDs that belong to this lot before updating projet_article entries
            // Consider gblocId to only delete lots with the same gbloc association
            let blocIdsQuery, blocIdsParams;

            if (gblocId === null) {
                // For standalone lots (null gbloc), we delete the entire structure including blocs
                blocIdsQuery = `
                    SELECT DISTINCT b.id 
                    FROM bloc b
                    INNER JOIN structure s ON s.bloc = b.id
                    INNER JOIN ouvrage o ON o.id = s.ouvrage
                    INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                    WHERE pl.id_projet = $1 AND pl.id_lot = $2
                `;
                blocIdsParams = [projectId, lotId];
            } else {
                // For GBloc-associated lots, we only update the lot to null, keeping blocs
                blocIdsQuery = `
                    SELECT DISTINCT b.id
                    FROM bloc b
                    INNER JOIN structure s ON s.bloc = b.id
                    INNER JOIN ouvrage o ON o.id = s.ouvrage
                    INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                    INNER JOIN projet_article pa ON pa.structure = s.id_structure
                    WHERE pl.id_projet = $1 AND pl.id_lot = $2 AND s.ouvrage = $3
                `;
                blocIdsParams = [projectId, lotId, gblocId];
            }

            const blocIdsResult = await client.query(blocIdsQuery, blocIdsParams);

            // Handle deletion differently for standalone lots vs GBloc lots
            let result;
            let detachResult = { rows: [] };
            if (gblocId === null) {
                const gblocsResult = await client.query(
                    `SELECT DISTINCT o.id AS ouvrage
                     FROM ouvrage o
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE pl.id_projet = $1 AND pl.id_lot = $2`,
                    [projectId, lotId]
                );
                if (gblocsResult.rows.length > 0) {
                    const gblocIds = gblocsResult.rows.map(row => row.ouvrage);
                    for (const gblocIdToDelete of gblocIds) {
                        const gblocBlocsResult = await client.query(
                            `SELECT DISTINCT s.bloc AS bloc
                             FROM structure s
                             INNER JOIN ouvrage o ON o.id = s.ouvrage
                             INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                             WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND s.bloc IS NOT NULL`,
                            [projectId, gblocIdToDelete]
                        );
                        const gblocBlocIds = gblocBlocsResult.rows.map(row => row.bloc);
                        await client.query('UPDATE events SET ouvrage = NULL WHERE ouvrage = $1', [gblocIdToDelete]);
                        if (gblocBlocIds.length > 0) {
                            await client.query('UPDATE events SET bloc = NULL WHERE bloc = ANY($1)', [gblocBlocIds]);
                        }
                        await client.query(
                            `DELETE FROM projet_article pa 
                             USING structure s, ouvrage o, projet_lot pl
                             WHERE pa.structure = s.id_structure 
                               AND s.ouvrage = o.id
                               AND o.projet_lot = pl.id_projet_lot
                               AND pl.id_projet = $1
                               AND s.ouvrage = $2`,
                            [projectId, gblocIdToDelete]
                        );

                        // ✅ FIX: Delete in correct order to avoid FK violations
                        // 1. Delete structure entries first (they reference blocs)
                        await client.query('DELETE FROM structure WHERE ouvrage = $1', [gblocIdToDelete]);

                        // 2. Then delete blocs (they reference ouvrages)
                        if (gblocBlocIds.length > 0) {
                            await client.query(`
                                DELETE FROM bloc 
                                WHERE id = ANY($1) OR ouvrage = $2
                            `, [gblocBlocIds, gblocIdToDelete]);
                        } else {
                            // Delete any blocs that reference this ouvrage even if no structure references
                            await client.query(`
                                DELETE FROM bloc WHERE ouvrage = $1
                            `, [gblocIdToDelete]);
                        }

                        // 3. Finally delete the ouvrage
                        await client.query('DELETE FROM ouvrage WHERE id = $1', [gblocIdToDelete]);
                        ouvrageDeleted = true;
                        deletedOuvrageId = gblocIdToDelete;
                    }
                }
                result = await client.query(
                    `DELETE FROM projet_article pa
                     USING structure s, ouvrage o, projet_lot pl
                     WHERE pa.structure = s.id_structure
                       AND s.ouvrage = o.id
                       AND o.projet_lot = pl.id_projet_lot
                       AND pl.id_projet = $1
                       AND pl.id_lot = $2 RETURNING pa.id`,
                    [projectId, lotId]
                );
                if (blocIdsResult.rows.length > 0) {
                    const blocIds = blocIdsResult.rows.map(row => row.id);
                    await client.query('UPDATE events SET bloc = NULL WHERE bloc = ANY($1)', [blocIds]);
                    await client.query(
                        `DELETE FROM bloc b 
                         WHERE b.id = ANY($1)
                           AND NOT EXISTS (SELECT 1 FROM structure s WHERE s.bloc = b.id)`,
                        [blocIds]
                    );
                }
                try {
                    const projetColCheck = await client.query(`
                        SELECT 1 FROM information_schema.columns 
                        WHERE table_name = 'projet_article' AND column_name = 'projet'
                    `);
                    const lotColCheck = await client.query(`
                        SELECT 1 FROM information_schema.columns 
                        WHERE table_name = 'projet_article' AND column_name = 'lot'
                    `);
                    if (projetColCheck.rows.length > 0 && lotColCheck.rows.length > 0) {
                        await client.query(
                            `DELETE FROM projet_article 
                             WHERE projet = $1 AND lot = $2 AND structure IS NULL`,
                            [projectId, lotId]
                        );
                    }
                } catch { }
                result = await client.query(
                    `DELETE FROM projet_lot 
                     WHERE id_projet = $1 AND id_lot = $2 RETURNING id_projet_lot`,
                    [projectId, lotId]
                );
                detachResult = result;
            } else {
                const gblocBlocsResult = await client.query(
                    `SELECT DISTINCT s.bloc AS bloc
                     FROM structure s
                     INNER JOIN ouvrage o ON o.id = s.ouvrage
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE pl.id_projet = $1 AND pl.id_lot = $2 AND s.ouvrage = $3 AND s.bloc IS NOT NULL`,
                    [projectId, lotId, gblocId]
                );
                const gblocBlocIds = gblocBlocsResult.rows.map(row => row.bloc);
                await client.query('UPDATE events SET ouvrage = NULL WHERE ouvrage = $1', [gblocId]);
                if (gblocBlocIds.length > 0) {
                    await client.query('UPDATE events SET bloc = NULL WHERE bloc = ANY($1)', [gblocBlocIds]);
                }
                result = await client.query(
                    `DELETE FROM projet_article pa
                     USING structure s, ouvrage o, projet_lot pl
                     WHERE pa.structure = s.id_structure 
                       AND s.ouvrage = o.id
                       AND o.projet_lot = pl.id_projet_lot
                       AND pl.id_projet = $1
                       AND pl.id_lot = $2
                       AND s.ouvrage = $3 RETURNING pa.id`,
                    [projectId, lotId, gblocId]
                );
                if (gblocBlocIds.length > 0) {
                    await client.query(`
                        DELETE FROM bloc b 
                        WHERE b.id = ANY($1)
                          AND NOT EXISTS (
                            SELECT 1 FROM structure s_other 
                            WHERE s_other.bloc = b.id
                          )
                    `, [gblocBlocIds]);
                }
                await client.query('DELETE FROM structure WHERE ouvrage = $1', [gblocId]);
                detachResult = await client.query('DELETE FROM ouvrage WHERE id = $1 RETURNING id', [gblocId]);
                detachedOuvrageDeleted = true;
                detachedOuvrageId = gblocId;
                const otherOuvrages = await client.query(
                    `SELECT 1 
                     FROM ouvrage o 
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE pl.id_projet = $1 AND pl.id_lot = $2 
                     LIMIT 1`,
                    [projectId, lotId]
                );
                if (otherOuvrages.rows.length === 0) {
                    try {
                        const projetColCheck = await client.query(`
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'projet_article' AND column_name = 'projet'
                        `);
                        const lotColCheck = await client.query(`
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'projet_article' AND column_name = 'lot'
                        `);
                        if (projetColCheck.rows.length > 0 && lotColCheck.rows.length > 0) {
                            await client.query(
                                `DELETE FROM projet_article 
                                 WHERE projet = $1 AND lot = $2 AND structure IS NULL`,
                                [projectId, lotId]
                            );
                        }
                    } catch { }
                    result = await client.query(
                        `DELETE FROM projet_lot 
                         WHERE id_projet = $1 AND id_lot = $2 RETURNING id_projet_lot`,
                        [projectId, lotId]
                    );
                    detachResult = result;
                }
            }

            // Recalculate project's selling price after lot deletion (inside transaction)
            // This ensures prix_vente is updated based on ALL remaining projet_article rows
            try {
                const Project = require('./Project');
                await Project.recalculatePrixVente(projectId, client);
                console.log(`✅ Recalculated prix_vente after deleting lot (lotName: ${lotName}, projectId: ${projectId})`);
            } catch (recalcError) {
                console.error('❌ Failed to recalculate prix_vente after deleting lot:', recalcError);
                // Don't throw - the lot was deleted successfully
            }

            // Get ouvrage name for event BEFORE commit (while client is still valid)
            let gblocNameForEvent = null;
            if (gblocId) {
                try {
                    const ouvrageResult = await client.query('SELECT nom_ouvrage FROM ouvrage WHERE id = $1', [gblocId]);
                    if (ouvrageResult.rows.length > 0) {
                        gblocNameForEvent = ouvrageResult.rows[0].nom_ouvrage;
                    }
                } catch (error) {
                    console.warn('Error fetching ouvrage name for lot deletion event:', error.message);
                }
            }

            // Store whether we should create event (check before commit)
            const shouldCreateEvent = (result.rows.length > 0 || detachResult.rows.length > 0) && userId;

            // Don't automatically renumber lots after deletion - let user manage designations manually

            await client.query('COMMIT');

            // Create lot deletion event AFTER commit (using pool, not client)
            if (shouldCreateEvent) {
                try {
                    await EventNotificationService.lotDeleted(projectId, userId, lotName, gblocId, gblocNameForEvent);
                    console.log('✅ Lot deletion event created successfully');
                } catch (eventError) {
                    console.error('Failed to create lot deletion event:', eventError);
                }
            }

            // Recalculate project price AFTER transaction is committed if ouvrage was deleted
            if (ouvrageDeleted && deletedOuvrageId) {
                try {
                    await Project.recalculatePrixVente(projectId);
                    console.log(`✅ Recalculated prix_vente after deleting ouvrage ${deletedOuvrageId} from project ${projectId} (lot deletion)`);
                } catch (recalcError) {
                    console.error(`❌ Failed to recalculate prix_vente after deleting ouvrage ${deletedOuvrageId} in lot deletion:`, recalcError);
                    // Don't throw - the ouvrage was deleted successfully
                }
            }

            // Recalculate project price AFTER transaction is committed if detached ouvrage was deleted
            if (detachedOuvrageDeleted && detachedOuvrageId) {
                try {
                    await Project.recalculatePrixVente(projectId);
                    console.log(`✅ Recalculated prix_vente after deleting detached ouvrage ${detachedOuvrageId} from project ${projectId} (lot detach)`);
                } catch (recalcError) {
                    console.error(`❌ Failed to recalculate prix_vente after deleting detached ouvrage ${detachedOuvrageId} in lot detach:`, recalcError);
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

    // Removed renumberLotsAfterDeletion - lot designations are now managed manually by the user

    /**
     * Get all lots for a project
     */
    static async findByProject(projectId) {
        const query = `
            SELECT 
                pl.id_lot AS lot_id,
                COALESCE(lot_niv2.niveau_2, '') AS lot,
                COUNT(*) as item_count
            FROM projet_article pa
            INNER JOIN structure s ON s.id_structure = pa.structure
            INNER JOIN ouvrage o ON o.id = s.ouvrage
            INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
            LEFT JOIN niveau_2 lot_niv2 ON pl.id_lot = lot_niv2.id_niveau_2
            WHERE pl.id_projet = $1 AND pl.id_lot IS NOT NULL
            GROUP BY pl.id_lot, lot_niv2.niveau_2
            ORDER BY lot
        `;
        const result = await pool.query(query, [projectId]);
        return result.rows;
    }

    /**
     * Get lot details with items
     */
    static async getDetails(projectId, lotName) {
        const lotLabelId = await ensureLotId(pool, lotName, { allowInsert: false });
        if (!lotLabelId) {
            return [];
        }
        const query = `
            SELECT pa.*,
                   COALESCE(lot_niv2.niveau_2, '') AS lot_name,
                   COALESCE(pa.designation_article, a."nom_article") as article_name,
                   b.nom_bloc,
                   o.nom_ouvrage as nom_ouvrage
            FROM projet_article pa
            INNER JOIN structure s ON s.id_structure = pa.structure
            INNER JOIN ouvrage o ON o.id = s.ouvrage
            INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
            LEFT JOIN niveau_2 lot_niv2 ON pl.id_lot = lot_niv2.id_niveau_2
            LEFT JOIN articles a ON a."ID" = pa.article
            LEFT JOIN bloc b ON b.id = s.bloc
            WHERE pl.id_projet = $1 AND pl.id_lot = $2
            ORDER BY pa.id
        `;
        const result = await pool.query(query, [projectId, lotLabelId]);
        return result.rows;
    }

    /**
     * Update lot designation
     * ✅ FIX: Only update the prefix (before lot name), preserve the lot name after first space
     */
    static async updateDesignation(projectId, lotId, designation, userId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Check if designation_lot column exists
            const designationLotCheck = await client.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'projet_lot' AND column_name = 'designation_lot'
            `);
            const hasDesignationLot = designationLotCheck.rows.length > 0;

            if (!hasDesignationLot) {
                throw new Error('designation_lot column does not exist');
            }

            // ✅ CRITICAL FIX: Save the designation as provided by the user
            // The lot name is stored separately in the lot.name field and should NEVER be in designation_lot
            // Do NOT try to preserve or append the lot name - it causes duplication issues
            // Only clean the designation to remove the lot name if it's accidentally included at the end
            let finalDesignation = designation.trim();

            // Get the lot name from the database to check if it's included in the designation
            // First try to get from projet_lot and niveau_2 (for lots without articles)
            const lotNameFromProjetLot = await client.query(
                `SELECT n2.niveau_2 as lot_name 
                 FROM projet_lot pl 
                 LEFT JOIN niveau_2 n2 ON pl.id_lot = n2.id_niveau_2 
                 WHERE pl.id_projet = $1 AND pl.id_lot = $2 
                 LIMIT 1`,
                [projectId, lotId]
            );

            let lotName = null;
            if (lotNameFromProjetLot.rows.length > 0 && lotNameFromProjetLot.rows[0].lot_name) {
                lotName = lotNameFromProjetLot.rows[0].lot_name;
            } else {
                const lotNameFromArticles = await client.query(
                    `SELECT n2.niveau_2 AS lot_name
                     FROM projet_article pa
                     INNER JOIN structure s ON s.id_structure = pa.structure
                     INNER JOIN ouvrage o ON o.id = s.ouvrage
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     LEFT JOIN niveau_2 n2 ON pl.id_lot = n2.id_niveau_2
                     WHERE pl.id_projet = $1 AND pl.id_lot = $2
                     LIMIT 1`,
                    [projectId, lotId]
                );
                if (lotNameFromArticles.rows.length > 0 && lotNameFromArticles.rows[0].lot_name) {
                    lotName = lotNameFromArticles.rows[0].lot_name;
                }
            }

            if (lotName && typeof lotName === 'string') {
                // Check if the designation ends with the lot name (with or without space)
                const trimmedLotName = lotName.trim();
                const designationLower = finalDesignation.toLowerCase();
                const lotNameLower = trimmedLotName.toLowerCase();

                // Remove lot name if it appears at the end of the designation
                if (designationLower.endsWith(' ' + lotNameLower) || designationLower.endsWith(lotNameLower)) {
                    // Find and remove the lot name from the end
                    const lastIndex = finalDesignation.toLowerCase().lastIndexOf(lotNameLower);
                    if (lastIndex !== -1) {
                        // Remove the lot name and any preceding space
                        let beforeLotName = finalDesignation.substring(0, lastIndex).trimEnd();
                        // Also remove any trailing space before the lot name
                        if (beforeLotName.endsWith(' ')) {
                            beforeLotName = beforeLotName.trimEnd();
                        }
                        finalDesignation = beforeLotName;
                    }
                }
            }

            // Update designation_lot in projet_lot table only
            // The designation_lot column only exists in projet_lot table, not in projet_article
            const result = await client.query(
                `UPDATE projet_lot 
                 SET designation_lot = $1 
                 WHERE id_projet = $2 AND id_lot = $3`,
                [finalDesignation, projectId, lotId]
            );

            await client.query('COMMIT');
            return {
                updated: result.rowCount,
                updatedProjetLot: result.rowCount, // Number of projet_lot rows updated
                updatedArticles: 0 // No articles updated since designation_lot doesn't exist there
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Reorder lots and update their designations
     */
    static async reorder(projectId, lotsData, userId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Check if designation_lot column exists
            const designationLotCheck = await client.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'projet_article' AND column_name = 'designation_lot'
            `);
            const hasDesignationLot = designationLotCheck.rows.length > 0;

            if (!hasDesignationLot) {
                throw new Error('designation_lot column does not exist');
            }

            // Update each lot's designation
            for (const lotData of lotsData) {
                const { lotId, designation } = lotData;
                if (lotId && designation) {
                    await client.query(
                        `UPDATE projet_article pa 
                         SET designation_lot = $1 
                         FROM structure s 
                         INNER JOIN ouvrage o ON o.id = s.ouvrage
                         INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                         WHERE pa.structure = s.id_structure 
                         AND pl.id_projet = $2 
                         AND pl.id_lot = $3`,
                        [designation, projectId, lotId]
                    );
                }
            }

            await client.query('COMMIT');
            return { reordered: lotsData.length };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = Lot;
