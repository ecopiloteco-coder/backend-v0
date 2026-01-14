const pool = require('../../config/db');

/**
 * ✅ CRITICAL FIX: Enhanced DesignationHelper with comprehensive conflict prevention and race condition handling
 */
class DesignationHelper {
    /**
     * ✅ CRITICAL FIX: Get next ouvrage designation with conflict prevention
     * @param {object} client - Database client
     * @param {number} projectId - Project ID
     * @param {number} lotId - Lot ID
     */
    static async getNextOuvrageDesignation(client, projectId, lotId) {
        // ✅ CRITICAL FIX: Lock the project to prevent race conditions
        // Use advisory lock instead of row lock to avoid blocking other project operations (like recalculatePrixVente)
        await client.query('SELECT pg_advisory_xact_lock(1, $1)', [projectId]);

        // Get existing ouvrages in this lot, ordered by ID
        // Check if new schema uses structure column instead of lot column
        const structureCheck = await client.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'projet_article' AND column_name = 'structure'
        `);
        const hasStructureId = structureCheck.rows.length > 0;

        let existingOuvrages;
        if (hasStructureId) {
            // New schema: use structure table for hierarchy
            existingOuvrages = await client.query(`
                SELECT DISTINCT o.id, o.designation 
                FROM ouvrage o
                INNER JOIN structure s ON s.ouvrage = o.id
                INNER JOIN projet_article pa ON pa.structure = s.id_structure
                INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                WHERE pl.id_projet = $1 AND pl.id_lot = $2
                ORDER BY o.id ASC
            `, [projectId, lotId]);
        } else {
            // Old schema: use lot column
            existingOuvrages = await client.query(`
                SELECT DISTINCT o.id, o.designation 
                FROM ouvrage o
                INNER JOIN structure s ON s.ouvrage = o.id
                INNER JOIN projet_article pa ON pa.structure = s.id_structure
                INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                WHERE pl.id_projet = $1 AND pl.id_lot = $2
                ORDER BY o.id ASC
            `, [projectId, lotId]);
        }

        let nextIndex = 1;
        let maxIndex = 0;

        // Find the highest existing designation index
        for (const ouvrage of existingOuvrages.rows) {
            if (ouvrage.designation) {
                const parts = ouvrage.designation.split('.');
                if (parts.length >= 2) {
                    const index = parseInt(parts[1], 10);
                    if (!isNaN(index) && index > maxIndex) {
                        maxIndex = index;
                    }
                }
            }
        }

        nextIndex = maxIndex + 1;

        // ✅ CRITICAL FIX: Validate uniqueness and find next available if conflict exists
        let candidateDesignation = `${lotId}.${nextIndex}`;
        const maxAttempts = 100; // Prevent infinite loops

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            let conflictCheck;
            if (hasStructureId) {
                conflictCheck = await client.query(`
                    SELECT COUNT(*) as count
                    FROM ouvrage o
                    INNER JOIN structure s ON s.ouvrage = o.id
                    INNER JOIN projet_article pa ON pa.structure = s.id_structure
                    INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                    WHERE pl.id_projet = $1 AND pl.id_lot = $2 AND o.designation = $3
                `, [projectId, lotId, candidateDesignation]);
            } else {
                conflictCheck = await client.query(`
                    SELECT COUNT(*) as count
                    FROM ouvrage o
                    INNER JOIN structure s ON s.ouvrage = o.id
                    INNER JOIN projet_article pa ON pa.structure = s.id_structure
                    INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                    WHERE pl.id_projet = $1 AND pl.id_lot = $2 AND o.designation = $3
                `, [projectId, lotId, candidateDesignation]);
            }

            if (parseInt(conflictCheck.rows[0].count) === 0) {
                // No conflict found, use this designation
                break;
            }

            // Conflict found, try next index
            nextIndex++;
            candidateDesignation = `${lotId}.${nextIndex}`;
        }

        return candidateDesignation;
    }

    /**
     * ✅ CRITICAL FIX: Recalculate all designations for a project with conflict prevention
     * @param {number} projectId - The project ID
     * @param {object} client - Optional database client (for transactions)
     * @param {string} startingDesignation - Optional starting designation (e.g., "1", "1.1", "1.1.1")
     * @param {number} targetOuvrageId - Optional ouvrage ID that should receive the starting designation
     * @param {number} lotId - Optional lot ID to filter by (if provided, only recalculates designations for that lot)
     */
    static async recalculateProjectDesignations(projectId, client = null, startingDesignation = null, targetOuvrageId = null, lotId = null) {
        const shouldRelease = !client;
        if (!client) {
            client = await pool.connect();
        }

        try {
            if (shouldRelease) await client.query('BEGIN');

            // ✅ CRITICAL FIX: Lock the project to prevent race conditions during recalculation
            // Use advisory lock instead of row lock to avoid blocking other project operations (like recalculatePrixVente)
            await client.query('SELECT pg_advisory_xact_lock(1, $1)', [projectId]);

            const structureCheck = await client.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'projet_article' AND column_name = 'structure'
            `);
            const hasStructureId = structureCheck.rows.length > 0;
            if (lotId && typeof lotId === 'string') {
                const lotIdRes = await client.query('SELECT id_niveau_2 FROM niveau_2 WHERE niveau_2 = $1', [lotId]);
                lotId = lotIdRes.rows[0]?.id_niveau_2 || null;
            }
            if (typeof lotId === 'string') {
                const parsedLot = parseInt(lotId, 10);
                lotId = isNaN(parsedLot) ? null : parsedLot;
            }

            // Get lot index for the "lotIndex.ouvrageIndex" format
            let lotIndex = 1;
            if (lotId) {
                // Count distinct lots in this project that have projet_article entries, up to and including this lot
                const lotIndexQuery = `
                    SELECT COUNT(DISTINCT pl.id_lot) as count
                    FROM projet_article pa
                    INNER JOIN structure s ON s.id_structure = pa.structure
                    INNER JOIN ouvrage o ON o.id = s.ouvrage
                    INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                    WHERE pl.id_projet = $1 AND pl.id_lot IS NOT NULL AND pl.id_lot <= $2
                `;
                const lotIndexResult = await client.query(lotIndexQuery, [projectId, lotId]);
                lotIndex = parseInt(lotIndexResult.rows[0].count || 0) || 1;
            }

            // Parse starting designation to extract base ouvrage number
            let baseOuvrageIndex = 1;
            if (startingDesignation) {
                const parts = String(startingDesignation).split('.');
                // For format "1.2", the ouvrage index is the second part
                if (parts.length >= 2) {
                    const ouvrageNum = parseInt(parts[1], 10);
                    if (!isNaN(ouvrageNum) && ouvrageNum > 0) {
                        baseOuvrageIndex = ouvrageNum;
                    }
                } else {
                    const baseNum = parseInt(parts[0], 10);
                    if (!isNaN(baseNum) && baseNum > 0) {
                        baseOuvrageIndex = baseNum;
                    }
                }
            }

            // Get all ouvrages for the project (optionally filtered by lot) ordered by id
            // Include existing designation to preserve user-provided designations
            // ✅ CRITICAL FIX: Lock ouvrages to prevent concurrent modifications
            let gblocsQuery;
            let gblocsParams;
            if (targetOuvrageId) {
                // Only process the target ouvrage - don't touch other ouvrages
                gblocsQuery = `SELECT o.id, o.nom_ouvrage as nom_gbloc, o.designation as existing_designation
                 FROM ouvrage o
                 INNER JOIN structure s ON s.ouvrage = o.id
                 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 WHERE o.id = $2 AND EXISTS (SELECT 1 FROM projet_article pa INNER JOIN structure s2 ON s2.id_structure = pa.structure INNER JOIN ouvrage o2 ON o2.id = s2.ouvrage INNER JOIN projet_lot pl2 ON pl2.id_projet_lot = o2.projet_lot WHERE pa.structure = s.id_structure AND pl2.id_projet = $1)
                 ORDER BY o.id ASC FOR UPDATE`;
                gblocsParams = [projectId, targetOuvrageId];
            } else if (lotId) {
                // Filter by specific lot - each lot has its own independent numbering
                if (hasStructureId) {
                    gblocsQuery = `SELECT o.id, o.nom_ouvrage as nom_gbloc, o.designation as existing_designation
                     FROM ouvrage o
                     INNER JOIN structure s ON s.ouvrage = o.id
                     WHERE EXISTS (SELECT 1 FROM projet_article pa 
                                   INNER JOIN structure s2 ON s2.id_structure = pa.structure
                                   INNER JOIN ouvrage o2 ON o2.id = s2.ouvrage
                                   INNER JOIN projet_lot pl ON pl.id_projet_lot = o2.projet_lot
                                   WHERE pa.structure = s.id_structure AND pl.id_projet = $1 AND pl.id_lot = $2)
                     ORDER BY o.id ASC FOR UPDATE`;
                } else {
                    gblocsQuery = `SELECT o.id, o.nom_ouvrage as nom_gbloc, o.designation as existing_designation
                     FROM ouvrage o
                     INNER JOIN structure s ON s.ouvrage = o.id
                     WHERE EXISTS (SELECT 1 FROM projet_article pa INNER JOIN structure s2 ON s2.id_structure = pa.structure INNER JOIN ouvrage o2 ON o2.id = s2.ouvrage INNER JOIN projet_lot pl ON pl.id_projet_lot = o2.projet_lot WHERE pa.structure = s.id_structure AND pl.id_projet = $1 AND pl.id_lot = $2)
                     ORDER BY o.id ASC FOR UPDATE`;
                }
                gblocsParams = [projectId, lotId];
            } else {
                // All ouvrages in project (legacy behavior)
                if (hasStructureId) {
                    gblocsQuery = `SELECT o.id, o.nom_ouvrage as nom_gbloc, o.designation as existing_designation
                     FROM ouvrage o
                     INNER JOIN structure s ON s.ouvrage = o.id
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE EXISTS (SELECT 1 FROM projet_article pa INNER JOIN structure s2 ON s2.id_structure = pa.structure INNER JOIN ouvrage o2 ON o2.id = s2.ouvrage INNER JOIN projet_lot pl2 ON pl2.id_projet_lot = o2.projet_lot WHERE pa.structure = s.id_structure AND pl2.id_projet = $1)
                     ORDER BY o.id ASC FOR UPDATE`;
                } else {
                    gblocsQuery = `SELECT o.id, o.nom_ouvrage as nom_gbloc, o.designation as existing_designation
                     FROM ouvrage o
                     INNER JOIN structure s ON s.ouvrage = o.id
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE EXISTS (SELECT 1 FROM projet_article pa INNER JOIN structure s2 ON s2.id_structure = pa.structure INNER JOIN ouvrage o2 ON o2.id = s2.ouvrage INNER JOIN projet_lot pl2 ON pl2.id_projet_lot = o2.projet_lot WHERE pa.structure = s.id_structure AND pl2.id_projet = $1)
                     ORDER BY o.id ASC FOR UPDATE`;
                }
                gblocsParams = [projectId];
            }
            const gblocsResult = await client.query(gblocsQuery, gblocsParams);

            let gblocIndex = baseOuvrageIndex;
            let isFirstOuvrage = true;
            let targetOuvrageProcessed = false;

            for (const gbloc of gblocsResult.rows) {
                let gblocDesignation;

                // If we have a target ouvrage ID and this is it, ALWAYS use the starting designation
                // This ensures that when duplicating, the new ouvrage gets the incremented designation
                if (targetOuvrageId && gbloc.id === targetOuvrageId && startingDesignation) {
                    const startingDesignationStr = String(startingDesignation).trim();
                    // Always use the starting designation for the target ouvrage (don't recalculate)
                    gblocDesignation = startingDesignationStr;
                    targetOuvrageProcessed = true;
                    // Don't increment index for target ouvrage - it uses the starting designation
                } else if (isFirstOuvrage && startingDesignation && !targetOuvrageId) {
                    // If this is the first ouvrage and we have a starting designation (and no target), check if it matches existing
                    const startingDesignationStr = String(startingDesignation).trim();
                    // If the existing designation matches the starting designation exactly, preserve it
                    if (gbloc.existing_designation === startingDesignationStr) {
                        // Preserve the exact designation that was provided
                        gblocDesignation = startingDesignationStr;
                    } else {
                        // Check if starting designation has exactly 2 parts (e.g., "2.1", "1.2")
                        // In this case, user wants to use the full designation for the ouvrage
                        const parts = startingDesignationStr.split('.');
                        if (parts.length === 2 && parts[0] && parts[1]) {
                            // User input like "2.1" - use the full designation for ouvrage
                            gblocDesignation = startingDesignationStr;
                        } else {
                            // Use lotIndex.ouvrageIndex format
                            gblocDesignation = `${lotIndex}.${gblocIndex}`;
                        }
                    }
                    isFirstOuvrage = false;
                    gblocIndex++;
                } else {
                    // IMPORTANT: When we have a target ouvrage, preserve existing designations for all other ouvrages
                    // Only recalculate if the ouvrage doesn't have a designation yet
                    if (targetOuvrageId && gbloc.existing_designation) {
                        // Preserve the existing designation - don't overwrite user-provided designations
                        gblocDesignation = gbloc.existing_designation;
                    } else {
                        // Regular numbering for other ouvrages: "lotIndex.ouvrageIndex" format
                        // Only use this if ouvrage has no existing designation
                        gblocDesignation = `${lotIndex}.${gblocIndex}`;
                        if (isFirstOuvrage) {
                            isFirstOuvrage = false;
                        }
                        gblocIndex++;
                    }
                }


                // Update ouvrage designation (only if it's different to avoid unnecessary updates)
                // IMPORTANT: Preserve existing designations - only update if ouvrage has no designation
                if (!gbloc.existing_designation || String(gbloc.existing_designation).trim() === '') {
                    // Only update if ouvrage doesn't have a designation yet
                    await client.query(
                        'UPDATE ouvrage SET designation = $1 WHERE id = $2',
                        [gblocDesignation, gbloc.id]
                    );
                } else {
                    // Preserve existing designation - don't overwrite user-provided designations
                    gblocDesignation = gbloc.existing_designation;
                }

                // Count articles directly in ouvrage (bloc IS NULL) - blocs should continue after these
                // Filter by lot if lotId is provided
                let articlesQuery;
                let articlesParams;
                if (hasStructureId) {
                    if (lotId) {
                        articlesQuery = `SELECT COUNT(*) as count 
                         FROM projet_article pa 
                         INNER JOIN structure s ON s.id_structure = pa.structure
                         INNER JOIN ouvrage o ON o.id = s.ouvrage
                         INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                         WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND s.bloc IS NULL AND pa.article IS NOT NULL AND pl.id_lot = $3`;
                        articlesParams = [projectId, gbloc.id, lotId];
                    } else {
                        articlesQuery = `SELECT COUNT(*) as count 
                         FROM projet_article pa 
                         INNER JOIN structure s ON s.id_structure = pa.structure
                         INNER JOIN ouvrage o ON o.id = s.ouvrage
                         INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                         WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND s.bloc IS NULL AND pa.article IS NOT NULL`;
                        articlesParams = [projectId, gbloc.id];
                    }
                } else {
                    if (lotId) {
                        articlesQuery = `SELECT COUNT(*) as count 
                         FROM projet_article pa 
                         INNER JOIN structure s ON s.id_structure = pa.structure
                         INNER JOIN ouvrage o ON o.id = s.ouvrage
                         INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                         WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND s.bloc IS NULL AND pa.article IS NOT NULL AND pl.id_lot = $3`;
                        articlesParams = [projectId, gbloc.id, lotId];
                    } else {
                        articlesQuery = `SELECT COUNT(*) as count 
                         FROM projet_article pa 
                         INNER JOIN structure s ON s.id_structure = pa.structure
                         INNER JOIN ouvrage o ON o.id = s.ouvrage
                         INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                         WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND s.bloc IS NULL AND pa.article IS NOT NULL`;
                        articlesParams = [projectId, gbloc.id];
                    }
                }
                const articlesInOuvrageResult = await client.query(articlesQuery, articlesParams);
                const articlesInOuvrageCount = parseInt(articlesInOuvrageResult.rows[0].count || 0);

                // Get all blocs under this ouvrage (optionally filtered by lot), ordered by id
                // Include existing designation to preserve user-provided designations
                // ✅ CRITICAL FIX: Lock blocs to prevent concurrent modifications
                let blocsQuery;
                let blocsParams;
                if (hasStructureId) {
                    if (lotId) {
                        blocsQuery = `SELECT b.id, b.designation as existing_designation FROM bloc b 
                         INNER JOIN structure s ON s.bloc = b.id
                         INNER JOIN projet_article pa ON pa.structure = s.id_structure
                         INNER JOIN projet_lot pl ON pl.id_projet_lot = (
                             SELECT pl2.id_projet_lot FROM projet_lot pl2 
                             WHERE pl2.id_projet = $1 AND pl2.id_lot = $3 LIMIT 1
                         )
                         WHERE pl.id_projet = $1 AND s.ouvrage = $2
                         ORDER BY b.id ASC FOR UPDATE`;
                        blocsParams = [projectId, gbloc.id, lotId];
                    } else {
                        blocsQuery = `SELECT b.id, b.designation as existing_designation FROM bloc b 
                         INNER JOIN structure s ON s.bloc = b.id
                         INNER JOIN projet_article pa ON pa.structure = s.id_structure
                         INNER JOIN ouvrage o ON o.id = s.ouvrage
                         INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                         WHERE pl.id_projet = $1 AND s.ouvrage = $2
                         ORDER BY b.id ASC FOR UPDATE`;
                        blocsParams = [projectId, gbloc.id];
                    }
                } else {
                    if (lotId) {
                        blocsQuery = `SELECT b.id, b.designation as existing_designation FROM bloc b 
                         INNER JOIN structure s ON s.bloc = b.id
                         WHERE EXISTS (SELECT 1 FROM projet_article pa INNER JOIN structure s2 ON s2.id_structure = pa.structure INNER JOIN ouvrage o2 ON o2.id = s2.ouvrage INNER JOIN projet_lot pl ON pl.id_projet_lot = o2.projet_lot WHERE pa.structure = s.id_structure AND pl.id_projet = $1 AND s.ouvrage = $2 AND pl.id_lot = $3) 
                         ORDER BY b.id ASC FOR UPDATE`;
                        blocsParams = [projectId, gbloc.id, lotId];
                    } else {
                        blocsQuery = `SELECT b.id, b.designation as existing_designation FROM bloc b 
                         INNER JOIN structure s ON s.bloc = b.id
                         WHERE EXISTS (SELECT 1 FROM projet_article pa INNER JOIN structure s2 ON s2.id_structure = pa.structure INNER JOIN ouvrage o2 ON o2.id = s2.ouvrage INNER JOIN projet_lot pl ON pl.id_projet_lot = o2.projet_lot WHERE pa.structure = s.id_structure AND pl.id_projet = $1 AND s.ouvrage = $2) 
                         ORDER BY b.id ASC FOR UPDATE`;
                        blocsParams = [projectId, gbloc.id];
                    }
                }
                const blocsResult = await client.query(blocsQuery, blocsParams);

                // Bloc index starts after articles directly in ouvrage
                // Example: ouvrage "2.3.1", 1 article "2.3.1.1", first bloc should be "2.3.1.2"
                let blocIndex = articlesInOuvrageCount + 1;
                // If this is the first bloc of first ouvrage and starting designation has bloc part, use it
                // But if ouvrage designation is multi-part (e.g., "2.1"), we should use it as base for blocs
                let firstBlocDesignation = null;
                if (gblocIndex === baseOuvrageIndex && startingDesignation) {
                    const parts = String(startingDesignation).split('.');
                    // If starting designation has exactly 3 parts (e.g., "1.1.1"), use it for first bloc
                    if (parts.length === 3) {
                        firstBlocDesignation = `${parts[0]}.${parts[1]}.${parts[2]}`;
                    }
                    // If starting designation has 2 parts (e.g., "2.1"), the ouvrage gets "2.1"
                    // and the first bloc should be "2.1.2" (after first article "2.1.1")
                    // So we don't set firstBlocDesignation in this case, it will use gblocDesignation
                }

                for (const bloc of blocsResult.rows) {
                    let blocDesignation;

                    // IMPORTANT: Preserve existing bloc designation if it exists
                    // This allows multiple blocs to have the same designation if user-provided
                    if (bloc.existing_designation && String(bloc.existing_designation).trim() !== '') {
                        // Preserve existing designation - don't overwrite user-provided designations
                        blocDesignation = bloc.existing_designation;
                    } else if (blocIndex === articlesInOuvrageCount + 1 && firstBlocDesignation) {
                        // Use first bloc designation if provided in starting designation
                        blocDesignation = firstBlocDesignation;
                    } else {
                        // Calculate new designation only if bloc doesn't have one
                        // Use the ouvrage designation (which could be "2.3.1" or "1") as the base
                        // Bloc index continues after articles directly in ouvrage
                        blocDesignation = `${gblocDesignation}.${blocIndex}`;
                    }

                    // ✅ CRITICAL FIX: Validate bloc designation uniqueness before updating
                    if (blocDesignation !== bloc.existing_designation) {
                        const blocConflict = await client.query(`
                            SELECT COUNT(*) as count
                            FROM bloc b2
                            INNER JOIN structure s2 ON s2.bloc = b2.id
                            INNER JOIN projet_article pa2 ON pa2.structure = s2.id_structure
                            INNER JOIN ouvrage o2 ON o2.id = s2.ouvrage
                            INNER JOIN projet_lot pl2 ON pl2.id_projet_lot = o2.projet_lot
                            WHERE pl2.id_projet = $1 AND s2.ouvrage = $2 AND b2.designation = $3 AND b2.id != $4
                        `, [projectId, gbloc.id, blocDesignation, bloc.id]);

                        if (parseInt(blocConflict.rows[0].count) > 0) {
                            // Skip this designation and try the next one
                            console.warn(`⚠️ Bloc designation conflict detected: ${blocDesignation} already exists, trying next index`);
                            blocDesignation = `${gblocDesignation}.${blocIndex + 1}`;
                        }
                    }

                    // Update bloc designation only if it doesn't have one or if we calculated a new one
                    if (!bloc.existing_designation || String(bloc.existing_designation).trim() === '') {
                        // Only update if bloc doesn't have a designation yet
                        await client.query(
                            'UPDATE bloc SET designation = $1 WHERE id = $2',
                            [blocDesignation, bloc.id]
                        );
                    }

                    // Update articles in this bloc
                    // If this is the first bloc of first ouvrage and starting designation has article part, use it
                    let firstArticleDesignation = null;
                    if (gblocIndex === baseOuvrageIndex && blocIndex === articlesInOuvrageCount + 1 && startingDesignation) {
                        const parts = String(startingDesignation).split('.');
                        // If starting designation has exactly 4 parts (e.g., "1.1.1.1"), use it for first article
                        if (parts.length === 4) {
                            firstArticleDesignation = `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3]}`;
                        }
                    }

                    await this.updateArticleDesignations(
                        client,
                        projectId,
                        bloc.id,
                        blocDesignation,
                        gblocDesignation,
                        firstArticleDesignation,
                        lotId
                    );

                    blocIndex++;
                }

                // Handle standalone blocs (no ouvrage) - only if no target ouvrage and no lot filter
                if (!targetOuvrageId && !lotId) {
                    // Get standalone blocs (ouvrage IS NULL), ordered by id
                    const standaloneBlocsResult = await client.query(`
                        SELECT DISTINCT b.id, b.designation as existing_designation FROM bloc b 
                        INNER JOIN structure s ON s.bloc = b.id
                        INNER JOIN projet_article pa ON pa.structure = s.id_structure
                        INNER JOIN ouvrage o ON o.id = s.ouvrage
                        INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                        WHERE pl.id_projet = $1 AND s.ouvrage IS NULL
                        ORDER BY b.id ASC
                    `, [projectId]);

                    let standaloneBlocIndex = 1;
                    for (const bloc of standaloneBlocsResult.rows) {
                        let blocDesignation;

                        // IMPORTANT: Preserve existing bloc designation if it exists
                        if (bloc.existing_designation && String(bloc.existing_designation).trim() !== '') {
                            blocDesignation = bloc.existing_designation;
                        } else {
                            // Calculate new designation only if bloc doesn't have one
                            blocDesignation = `${standaloneBlocIndex}.1`;
                        }

                        // ✅ CRITICAL FIX: Validate standalone bloc designation uniqueness
                        if (blocDesignation !== bloc.existing_designation) {
                            const standaloneConflict = await client.query(`
                                SELECT COUNT(*) as count
                                FROM bloc b2
                                INNER JOIN structure s2 ON s2.bloc = b2.id
                                INNER JOIN projet_article pa2 ON pa2.structure = s2.id_structure
                                INNER JOIN ouvrage o2 ON o2.id = s2.ouvrage
                                INNER JOIN projet_lot pl2 ON pl2.id_projet_lot = o2.projet_lot
                                WHERE pl2.id_projet = $1 AND s2.ouvrage IS NULL AND b2.designation = $2 AND b2.id != $3
                            `, [projectId, blocDesignation, bloc.id]);

                            if (parseInt(standaloneConflict.rows[0].count) > 0) {
                                // Skip this designation and try the next one
                                console.warn(`⚠️ Standalone bloc designation conflict detected: ${blocDesignation} already exists, trying next index`);
                                blocDesignation = `${standaloneBlocIndex + 1}.1`;
                            }
                        }

                        // Update bloc designation only if it doesn't have one
                        if (!bloc.existing_designation || String(bloc.existing_designation).trim() === '') {
                            await client.query(
                                'UPDATE bloc SET designation = $1 WHERE id = $2',
                                [blocDesignation, bloc.id]
                            );
                        }

                        // Update articles in this bloc
                        await this.updateArticleDesignations(
                            client,
                            projectId,
                            bloc.id,
                            blocDesignation,
                            `${standaloneBlocIndex}`,
                            null,
                            lotId
                        );

                        standaloneBlocIndex++;
                    }
                }
            }

            if (shouldRelease) await client.query('COMMIT');

            return { success: true, message: 'Designations recalculated successfully' };
        } catch (error) {
            if (shouldRelease) {
                try { await client.query('ROLLBACK'); } catch { }
            }

            // If we hit permissions or missing-table errors, log and allow caller to continue
            if (error && (error.code === '42501' || error.code === '42P01')) {
                console.warn('Skipping designation recalculation due to DB error:', error.message);
                return { skipped: true };
            }

            throw error;
        } finally {
            if (shouldRelease) {
                client.release();
            }
        }
    }

    /**
     * ✅ CRITICAL FIX: Update article designations for a specific bloc with conflict prevention
     * @param {object} client - Database client
     * @param {number} projectId - Project ID
     * @param {number} blocId - Bloc ID
     * @param {string} blocDesignation - Bloc designation (e.g., "1.1")
     * @param {string} ouvrageDesignation - Ouvrage designation (e.g., "1")
     * @param {string} firstArticleDesignation - Optional first article designation
     * @param {number} lotId - Optional lot ID to filter by
     */
    static async updateArticleDesignations(client, projectId, blocId, blocDesignation, ouvrageDesignation, firstArticleDesignation = null, lotId = null) {
        // Get all articles in this bloc, ordered by id (optionally filtered by lot)
        // ✅ CRITICAL FIX: Lock articles to prevent concurrent modifications

        // Check if projet column exists in projet_article table
        const projetColCheck = await client.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'projet_article' AND column_name = 'projet'
        `);
        const hasProjetCol = projetColCheck.rows.length > 0;
        let articlesQuery;
        let articlesParams;
        if (hasProjetCol) {
            // Schema with projet column
            if (lotId) {
                articlesQuery = `SELECT pa.id FROM projet_article pa
                    INNER JOIN structure s ON s.id_structure = pa.structure
                    INNER JOIN ouvrage o ON o.id = s.ouvrage
                    INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                    WHERE pl.id_projet = $1 AND s.bloc = $2 AND pa.article IS NOT NULL AND pl.id_lot = $3
                    ORDER BY pa.id ASC FOR UPDATE`;
                articlesParams = [projectId, blocId, lotId];
            } else {
                articlesQuery = `SELECT pa.id FROM projet_article pa
                    INNER JOIN structure s ON s.id_structure = pa.structure
                    INNER JOIN ouvrage o ON o.id = s.ouvrage
                    INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                    WHERE pl.id_projet = $1 AND s.bloc = $2 AND pa.article IS NOT NULL
                    ORDER BY pa.id ASC FOR UPDATE`;
                articlesParams = [projectId, blocId];
            }
        } else {
            // Structure-based schema: need to join with structure to filter by project
            if (lotId) {
                articlesQuery = `SELECT pa.id FROM projet_article pa
                    INNER JOIN structure s ON s.id_structure = pa.structure
                    INNER JOIN ouvrage o ON o.id = s.ouvrage
                    INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                    WHERE pl.id_projet = $1 AND s.bloc = $2 AND pa.article IS NOT NULL AND pl.id_lot = $3
                    ORDER BY pa.id ASC FOR UPDATE`;
                articlesParams = [projectId, blocId, lotId];
            } else {
                articlesQuery = `SELECT pa.id FROM projet_article pa
                    INNER JOIN structure s ON s.id_structure = pa.structure
                    INNER JOIN ouvrage o ON o.id = s.ouvrage
                    INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                    WHERE pl.id_projet = $1 AND s.bloc = $2 AND pa.article IS NOT NULL
                    ORDER BY pa.id ASC FOR UPDATE`;
                articlesParams = [projectId, blocId];
            }
        }
        const articlesResult = await client.query(articlesQuery, articlesParams);

        let articleIndex = 1;
        for (const article of articlesResult.rows) {
            let articleDesignation;

            // If this is the first article and we have a firstArticleDesignation, use it
            if (articleIndex === 1 && firstArticleDesignation) {
                articleDesignation = firstArticleDesignation;
            } else {
                // Use bloc designation as base (e.g., "5.2.1" -> "5.2.1.1", "5.2.1.2", etc.)
                articleDesignation = `${blocDesignation}.${articleIndex}`;
            }

            // ✅ CRITICAL FIX: Validate article designation uniqueness
            let articleConflict;
            if (hasProjetCol) {
                articleConflict = await client.query(`
                    SELECT COUNT(*) as count
                    FROM projet_article pa2
                    WHERE pa2.projet = $1 AND pa2.bloc = $2 AND pa2.designation_article = $3 AND pa2.id != $4
                `, [projectId, blocId, articleDesignation, article.id]);
            } else {
                articleConflict = await client.query(`
                    SELECT COUNT(*) as count
                    FROM projet_article pa2
                    INNER JOIN structure s ON s.id_structure = pa2.structure
                    INNER JOIN ouvrage o ON o.id = s.ouvrage
                    INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                    WHERE pl.id_projet = $1 AND s.bloc = $2 AND pa2.designation_article = $3 AND pa2.id != $4
                `, [projectId, blocId, articleDesignation, article.id]);
            }

            if (parseInt(articleConflict.rows[0].count) > 0) {
                // Skip this designation and try the next one
                console.warn(`⚠️ Article designation conflict detected: ${articleDesignation} already exists in bloc, trying next index`);
                articleDesignation = `${blocDesignation}.${articleIndex + 1}`;
            }

            // Update article designation
            await client.query(
                'UPDATE projet_article SET designation_article = $1 WHERE id = $2',
                [articleDesignation, article.id]
            );

            articleIndex++;
        }
    }

    /**
     * ✅ CRITICAL FIX: Get next article designation with conflict prevention
     * @param {object} client - Database client
     * @param {number} projectId - Project ID
     * @param {number|null} ouvrageId - Ouvrage ID (null if adding to standalone bloc context)
     * @param {number|null} blocId - Bloc ID (null if adding directly to ouvrage)
     */
    static async getNextArticleDesignation(client, projectId, ouvrageId = null, blocId = null) {
        // Lock the project to avoid race conditions
        // Use advisory lock instead of row lock to avoid blocking other project operations (like recalculatePrixVente)
        await client.query('SELECT pg_advisory_xact_lock(1, $1)', [projectId]);

        // If adding to a bloc, require bloc designation and use it as base
        if (blocId) {
            const blocRes = await client.query('SELECT designation FROM bloc WHERE id = $1', [blocId]);
            const blocDesignation = (blocRes.rows[0]?.designation || '').trim();

            if (!blocDesignation) {
                throw new Error('La désignation du bloc est requise avant d\'ajouter des articles');
            }

            const countRes = await client.query(
                `SELECT COUNT(*) as count
                 FROM projet_article pa
                 INNER JOIN structure s ON s.id_structure = pa.structure
                 INNER JOIN ouvrage o ON o.id = s.ouvrage
                 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 WHERE pl.id_projet = $1 AND s.bloc = $2 AND pa.article IS NOT NULL`,
                [projectId, blocId]
            );
            const nextIndex = parseInt(countRes.rows[0]?.count || 0, 10) + 1;
            return `${blocDesignation}.${nextIndex}`;
        }

        // If adding directly to an ouvrage, use ouvrage designation as base
        if (ouvrageId) {
            const ouvRes = await client.query('SELECT designation FROM ouvrage WHERE id = $1', [ouvrageId]);
            const ouvrageDesignation = (ouvRes.rows[0]?.designation || '').trim();

            const countRes = await client.query(
                `SELECT COUNT(*) as count
                 FROM projet_article pa
                 INNER JOIN structure s ON s.id_structure = pa.structure
                 INNER JOIN ouvrage o ON o.id = s.ouvrage
                 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND s.bloc IS NULL AND pa.article IS NOT NULL`,
                [projectId, ouvrageId]
            );
            const nextIndex = parseInt(countRes.rows[0]?.count || 0, 10) + 1;

            const base = ouvrageDesignation || '1';
            return `${base}.${nextIndex}`;
        }

        // Fallback default if neither bloc nor ouvrage is provided
        return '1.1.1';
    }

    /**
     * ✅ CRITICAL FIX: Update article designations for articles directly in ouvrage (bloc IS NULL)
     * @param {object} client - Database client
     * @param {number} projectId - Project ID
     * @param {number} ouvrageId - Ouvrage ID
     * @param {string} ouvrageDesignation - Ouvrage designation (e.g., "1")
     * @param {number} lotId - Optional lot ID to filter by
     */
    static async updateOuvrageArticleDesignations(client, projectId, ouvrageId, ouvrageDesignation, lotId = null) {
        // Get all articles directly in ouvrage (bloc IS NULL), ordered by id (optionally filtered by lot)
        // ✅ CRITICAL FIX: Lock articles to prevent concurrent modifications
        let articlesQuery;
        let articlesParams;
        if (lotId) {
            articlesQuery = `
                SELECT pa.id 
                FROM projet_article pa
                INNER JOIN structure s ON s.id_structure = pa.structure
                INNER JOIN ouvrage o ON o.id = s.ouvrage
                INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND s.bloc IS NULL AND pa.article IS NOT NULL AND pl.id_lot = $3
                ORDER BY pa.id ASC FOR UPDATE
            `;
            articlesParams = [projectId, ouvrageId, lotId];
        } else {
            articlesQuery = `
                SELECT pa.id 
                FROM projet_article pa
                INNER JOIN structure s ON s.id_structure = pa.structure
                INNER JOIN ouvrage o ON o.id = s.ouvrage
                INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND s.bloc IS NULL AND pa.article IS NOT NULL
                ORDER BY pa.id ASC FOR UPDATE
            `;
            articlesParams = [projectId, ouvrageId];
        }
        const articlesResult = await client.query(articlesQuery, articlesParams);

        let articleIndex = 1;
        for (const article of articlesResult.rows) {
            // Articles directly in ouvrage: Format: ouvrageDesignation.articleIndex (e.g., "5.6.1", "5.6.2")
            const articleDesignation = `${ouvrageDesignation}.${articleIndex}`;

            // ✅ CRITICAL FIX: Validate ouvrage article designation uniqueness
            const ouvrageArticleConflict = await client.query(`
                SELECT COUNT(*) as count
                FROM projet_article pa2
                INNER JOIN structure s2 ON s2.id_structure = pa2.structure
                INNER JOIN ouvrage o2 ON o2.id = s2.ouvrage
                INNER JOIN projet_lot pl2 ON pl2.id_projet_lot = o2.projet_lot
                WHERE pl2.id_projet = $1 AND s2.ouvrage = $2 AND s2.bloc IS NULL AND pa2.designation_article = $3 AND pa2.id != $4
            `, [projectId, ouvrageId, articleDesignation, article.id]);

            if (parseInt(ouvrageArticleConflict.rows[0].count) > 0) {
                // Skip this designation and try the next one
                console.warn(`⚠️ Ouvrage article designation conflict detected: ${articleDesignation} already exists, trying next index`);
                continue;
            }

            // Update article designation
            await client.query(
                'UPDATE projet_article SET designation_article = $1 WHERE id = $2',
                [articleDesignation, article.id]
            );

            articleIndex++;
        }
    }

    /**
     * Check if an ouvrage designation is available in the project
     * @param {object} client - Database client
     * @param {number} projectId - Project ID
     * @param {string} designation - Designation to check
     * @param {number|null} excludeId - ID to exclude (e.g. self when updating)
     * @returns {Promise<boolean>} - True if available, false if conflict
     */
    static async checkOuvrageDesignationAvailability(client, projectId, designation, excludeId = null) {
        // Check if new schema uses structure column instead of lot column
        const structureCheck = await client.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'projet_article' AND column_name = 'structure'
        `);
        const hasStructureId = structureCheck.rows.length > 0;

        let query;
        if (hasStructureId) {
            query = `
                SELECT COUNT(*) as count
                FROM ouvrage o
                INNER JOIN structure s ON s.ouvrage = o.id
                INNER JOIN projet_article pa ON pa.structure = s.id_structure
                INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                WHERE pl.id_projet = $1 AND o.designation = $2 ${excludeId ? 'AND o.id != $3' : ''}
            `;
        } else {
            query = `
                SELECT COUNT(*) as count
                FROM ouvrage o
                INNER JOIN structure s ON s.ouvrage = o.id
                INNER JOIN projet_article pa ON pa.structure = s.id_structure
                INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                WHERE pl.id_projet = $1 AND o.designation = $2 ${excludeId ? 'AND o.id != $3' : ''}
            `;
        }

        const params = excludeId ? [projectId, designation, excludeId] : [projectId, designation];
        const result = await client.query(query, params);

        return parseInt(result.rows[0].count) === 0;
    }

    /**
     * Check if a bloc designation is available in the ouvrage
     * @param {object} client - Database client
     * @param {number} projectId - Project ID
     * @param {number} ouvrageId - Ouvrage ID
     * @param {string} designation - Designation to check
     * @param {number|null} excludeId - ID to exclude
     * @returns {Promise<boolean>} - True if available, false if conflict
     */
    static async checkBlocDesignationAvailability(client, projectId, ouvrageId, designation, excludeId = null) {
        const query = `
            SELECT COUNT(*) as count
            FROM bloc b
            INNER JOIN structure s ON s.bloc = b.id
            INNER JOIN projet_article pa ON pa.structure = s.id_structure
            INNER JOIN ouvrage o ON o.id = s.ouvrage
            INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
            WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND b.designation = $3 ${excludeId ? 'AND b.id != $4' : ''}
        `;

        const params = excludeId ? [projectId, ouvrageId, designation, excludeId] : [projectId, ouvrageId, designation];
        const result = await client.query(query, params);

        return parseInt(result.rows[0].count) === 0;
    }

    /**
     * Check if an article designation is available in the context (bloc or ouvrage)
     * @param {object} client - Database client
     * @param {number} projectId - Project ID
     * @param {number|null} blocId - Bloc ID (null if in ouvrage)
     * @param {number|null} ouvrageId - Ouvrage ID
     * @param {string} designation - Designation to check
     * @param {number|null} excludeId - ID to exclude
     * @returns {Promise<boolean>} - True if available, false if conflict
     */
    static async checkArticleDesignationAvailability(client, projectId, blocId, ouvrageId, designation, excludeId = null, structureId = null) {
        let query;
        let params;

        if (structureId) {
            query = `
                SELECT COUNT(*) as count
                FROM projet_article pa
                INNER JOIN structure s ON s.id_structure = pa.structure
                INNER JOIN ouvrage o ON o.id = s.ouvrage
                INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                WHERE pl.id_projet = $1 AND pa.structure = $2 AND pa.designation_article = $3 ${excludeId ? 'AND pa.id != $4' : ''}
            `;
            params = excludeId ? [projectId, structureId, designation, excludeId] : [projectId, structureId, designation];
        } else if (blocId) {
            query = `
                SELECT COUNT(*) as count
                FROM projet_article pa
                INNER JOIN structure s ON s.id_structure = pa.structure
                INNER JOIN ouvrage o ON o.id = s.ouvrage
                INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                WHERE pl.id_projet = $1 AND s.bloc = $2 AND pa.designation_article = $3 ${excludeId ? 'AND pa.id != $4' : ''}
            `;
            params = excludeId ? [projectId, blocId, designation, excludeId] : [projectId, blocId, designation];
        } else if (ouvrageId) {
            query = `
                SELECT COUNT(*) as count
                FROM projet_article pa
                INNER JOIN structure s ON s.id_structure = pa.structure
                INNER JOIN ouvrage o ON o.id = s.ouvrage
                INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND s.bloc IS NULL AND pa.designation_article = $3 ${excludeId ? 'AND pa.id != $4' : ''}
            `;
            params = excludeId ? [projectId, ouvrageId, designation, excludeId] : [projectId, ouvrageId, designation];
        } else {
            return true; // Should not happen
        }

        const result = await client.query(query, params);
        return parseInt(result.rows[0].count) === 0;
    }

}

module.exports = DesignationHelper;
