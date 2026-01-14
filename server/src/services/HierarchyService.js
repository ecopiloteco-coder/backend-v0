const pool = require('../../config/db');
const { getNextAvailableBlocId, getNextAvailableOuvrageId, getNextSequenceValue } = require('../utils/idConflictResolver');
const { buildNormalizedArticlesSubquery } = require('../services/NiveauService');
const { ensureLotId } = require('../utils/lotHelper');

class HierarchyService {
    /**
     * Get all lots for a project (for UI tabs/navigation)
     * Lots are extracted from projet_article where lot is not null
     */
    static async getProjectLots(projectId, options = {}) {
        const { includeCounts = true, orderBy = 'pl.id_lot' } = options;

        // Base query to get all lots for a project, including those without articles
        const baseQuery = `
            SELECT 
                pl.id_lot AS lot_id,
                COALESCE(n2.niveau_2, '') AS lot,
                pl.designation_lot
            FROM projet_lot pl
            LEFT JOIN niveau_2 n2 ON pl.id_lot = n2.id_niveau_2
            WHERE pl.id_projet = $1
        `;

        if (includeCounts) {
            const query = `
                SELECT 
                    base.lot_id,
                    base.lot,
                    base.designation_lot,
                    COALESCE(counts.item_count, 0) AS item_count,
                    COALESCE(counts.article_count, 0) AS article_count
                FROM (${baseQuery}) base
                LEFT JOIN (
                    SELECT 
                        pl.id_lot AS lot_id,
                        COUNT(pa.id) AS item_count,
                        COUNT(CASE WHEN pa.article IS NOT NULL THEN 1 END) AS article_count
                    FROM projet_lot pl
                    LEFT JOIN ouvrage o ON o.projet_lot = pl.id_projet_lot
                    LEFT JOIN structure s ON s.ouvrage = o.id
                    LEFT JOIN projet_article pa ON pa.structure = s.id_structure
                    WHERE pl.id_projet = $1
                    GROUP BY pl.id_lot
                ) counts ON base.lot_id = counts.lot_id
                ORDER BY ${orderBy}
            `;
            const result = await pool.query(query, [projectId, projectId]);
            return result.rows;
        } else {
            const query = `${baseQuery} ORDER BY ${orderBy}`;
            const result = await pool.query(query, [projectId]);
            return result.rows;
        }
    }

    /**
     * Get all GBlocs for a project (only entries with ouvrage)
     * Returns: entries grouped by (lot + gbloc), where gbloc must NOT be NULL
     */
    static async getProjectGblocs(projectId, options = {}) {
        const { includeTotals = true, includeCounts = true, lotFilter = null } = options;
        let resolvedLotFilter = null;
        if (lotFilter) {
            resolvedLotFilter = await ensureLotId(pool, lotFilter, { allowInsert: false });
        }

        let params = [projectId];
        let lotFilterClause = '';

        if (resolvedLotFilter !== null) {
            lotFilterClause = `AND pl.id_lot = $2`;
            params.push(resolvedLotFilter);
        }

        // Build counts and totals fields
        const countFields = includeCounts ?
            ', COALESCE(COUNT(DISTINCT s.bloc), 0) as bloc_count, COALESCE(COUNT(CASE WHEN pa.article IS NOT NULL THEN 1 END), 0) as article_count' : '';

        const totalFields = includeTotals ?
            ', COALESCE(SUM(pa.total_ttc), 0)::float as total_ttc, COALESCE(SUM(pa.prix_total_ht), 0)::float as total_ht' : '';

        const zeroCountFields = includeCounts ? ', 0 as bloc_count, 0 as article_count' : '';
        const zeroTotalFields = includeTotals ? ', 0::float as total_ttc, 0::float as total_ht' : '';

        const query = `
            SELECT 
                pl.id_lot AS lot_id,
                COALESCE(n2.niveau_2, '') AS lot,
                o.id as gbloc_id,
                o.nom_ouvrage as gbloc_label,
                o.designation,
                pl.designation_lot
                ${countFields}
                ${totalFields}
            FROM ouvrage o
            INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
            LEFT JOIN niveau_2 n2 ON n2.id_niveau_2 = pl.id_lot
            LEFT JOIN structure s ON s.ouvrage = o.id
            LEFT JOIN projet_article pa ON pa.structure = s.id_structure
            WHERE pl.id_projet = $1 ${lotFilterClause}
            GROUP BY pl.id_lot, n2.niveau_2, o.id, o.nom_ouvrage, o.designation, pl.designation_lot
            
            UNION ALL
            
            SELECT 
                NULL AS lot_id,
                '' AS lot,
                o.id as gbloc_id,
                o.nom_ouvrage as gbloc_label,
                o.designation,
                '' as designation_lot
                ${zeroCountFields}
                ${zeroTotalFields}
            FROM ouvrage o
            WHERE o.projet_lot IS NULL
            
            ORDER BY 2, 4
        `;

        const result = await pool.query(query, params);
        return result.rows;
    }

    /**
     * Get a specific GBloc by its composite key
     */
    static async getGblocByKey(projectId, lot, gblocId) {
        // gblocId is the integer ID from ouvrage table
        // First, try to get from projet_article (if articles exist)
        try {
            const query = `
                SELECT 
                    pl.id_lot as lot, 
                    s.ouvrage as gbloc_id,
                    o.nom_ouvrage as gbloc_label,
                    o.id as gbloc_id,
                    o.designation,
                    COUNT(DISTINCT s.bloc) as bloc_count,
                    COUNT(CASE WHEN pa.article IS NOT NULL THEN 1 END) as article_count,
                    COALESCE(SUM(pa.total_ttc), 0)::float as total_ttc,
                    COALESCE(SUM(pa.prix_total_ht), 0)::float as total_ht
                FROM projet_article pa
                INNER JOIN structure s ON s.id_structure = pa.structure
                INNER JOIN ouvrage o ON o.id = s.ouvrage
                INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                WHERE pl.id_projet = $1 AND (pl.id_lot = $2 OR ($2 IS NULL AND pl.id_lot IS NULL)) AND s.ouvrage = $3
                GROUP BY pl.id_lot, s.ouvrage, o.nom_ouvrage, o.id, o.designation
            `;

            const result = await pool.query(query, [projectId, lot, gblocId]);
            if (result.rows.length > 0) {
                return result.rows[0];
            }
        } catch (error) {
            // If query fails (e.g., column doesn't exist or no rows), fall back to gbloc table
            console.warn('getGblocByKey query failed, falling back to gbloc table:', error.message);
        }

        // Fallback: get from ouvrage table directly if no projet_article rows exist yet
        try {
            const ouvrageQuery = `
                SELECT 
                    $2::text as lot,
                    o.id as gbloc_id,
                    o.nom_ouvrage as gbloc_label,
                    0 as bloc_count,
                    0 as article_count,
                    0::float as total_ttc,
                    0::float as total_ht
                FROM ouvrage o
                WHERE o.id = $1
            `;
            const ouvrageResult = await pool.query(ouvrageQuery, [gblocId, lot]);
            return ouvrageResult.rows[0] || null;
        } catch (error) {
            console.error('getGblocByKey fallback also failed:', error);
            return null;
        }
    }

    /**
     * Get all Blocs within a GBloc
     * Bloc = combination of (lot + gbloc + bloc from Niveau_4)
     */
    static async getGblocBlocs(projectId, gblocKey, options = {}) {
        const { includeTotals = true, includeCounts = true } = options;
        // gblocKey can be either { lot, gbloc_id } or a parsed composite string
        // If it's a string, parse it; otherwise use the object directly
        let lot, gblocId;
        if (typeof gblocKey === 'string') {
            const parts = gblocKey.split(':');
            // Format: lot:gbloc_id (no niv_1 anymore)
            lot = parts[0];
            gblocId = parseInt(parts[1], 10);
        } else {
            lot = gblocKey.lot;
            gblocId = gblocKey.gbloc_id || parseInt(gblocKey.gbloc, 10);
        }

        const selectFields = [
            'pl.id_lot as lot',
            's.ouvrage as gbloc_id',
            's.bloc as bloc_id',
            'b.nom_bloc as bloc_name',
            'b.unite',
            'b.quantite',
            'b.pu',
            'b.designation'
        ];

        if (includeCounts) {
            selectFields.push('COUNT(CASE WHEN pa.article IS NOT NULL THEN 1 END) as article_count');
        }

        if (includeTotals) {
            selectFields.push(`
                COALESCE(SUM(pa.total_ttc), 0)::float as total_ttc,
                COALESCE(SUM(pa.prix_total_ht), 0)::float as total_ht
            `);
        }

        const query = `
            SELECT ${selectFields.join(', ')}
            FROM structure s
            INNER JOIN ouvrage o ON o.id = s.ouvrage
            INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
            LEFT JOIN bloc b ON b.id = s.bloc
            LEFT JOIN projet_article pa ON pa.structure = s.id_structure
            WHERE pl.id_projet = $1 
              AND (pl.id_lot = $2 OR ($2 IS NULL AND pl.id_lot IS NULL)) 
              AND s.ouvrage = $3 
              AND s.bloc IS NOT NULL
            GROUP BY pl.id_lot, s.ouvrage, s.bloc, b.nom_bloc, b.id, b.unite, b.quantite, b.pu, b.designation, pl.designation_lot
            ORDER BY b.designation
        `;

        const result = await pool.query(query, [projectId, lot, gblocId]);
        return result.rows;
    }

    /**
     * Get a specific Bloc by its composite key
     */
    static async getBlocByKey(projectId, lot, gblocId, blocId) {
        const query = `
            SELECT 
                pl.id_lot as lot,
                s.ouvrage as gbloc_id,
                s.bloc as bloc_id, 
                b.nom_bloc as bloc_name,
                b.id as bloc_id,
                b.designation,
                COUNT(CASE WHEN pa.article IS NOT NULL THEN 1 END) as article_count,
                COALESCE(SUM(pa.total_ttc), 0)::float as total_ttc,
                COALESCE(SUM(pa.prix_total_ht), 0)::float as total_ht
            FROM structure s
            INNER JOIN ouvrage o ON o.id = s.ouvrage
            INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
            LEFT JOIN bloc b ON b.id = s.bloc
            LEFT JOIN projet_article pa ON pa.structure = s.id_structure
            WHERE pl.id_projet = $1 
              AND (pl.id_lot = $2 OR ($2 IS NULL AND pl.id_lot IS NULL)) 
              AND s.ouvrage = $3 
              AND s.bloc = $4
            GROUP BY pl.id_lot, s.ouvrage, s.bloc, b.nom_bloc, b.id, b.designation
        `;

        const result = await pool.query(query, [projectId, lot, gblocId, blocId]);
        return result.rows[0] || null;
    }

    /**
     * Get all articles within a Bloc
     */
    static async getBlocArticles(projectId, blocKey, options = {}) {
        const { includeDetails = true, page = 1, limit = 100 } = options;
        // blocKey can be either { lot, ouvrage_id, bloc_id } or a parsed composite string
        let lot, ouvrageId, blocId;
        if (typeof blocKey === 'string') {
            const parts = blocKey.split(':');
            // Format: lot:ouvrage_id:bloc_id
            lot = parts[0];
            ouvrageId = parseInt(parts[1], 10);
            blocId = parseInt(parts[2], 10);
        } else {
            lot = blocKey.lot;
            ouvrageId = blocKey.gbloc_id || parseInt(blocKey.gbloc, 10);
            blocId = blocKey.bloc_id || parseInt(blocKey.bloc, 10);
        }

        const offset = (page - 1) * limit;

        let selectFields = [
            'pa.id',
            'pl.designation_lot',
            'pl.id_lot as lot',
            's.id_structure', // ✅ ADD: structure ID for unique identification
            's.ouvrage as gbloc_id',
            's.bloc as bloc_id',
            's.action', // ✅ ADD: structure.action to determine bloc vs ouvrage
            'pa.article',
            'a."Niveau_5__article" as article_name',
            'a."Niveau_6__detail_article" as detail_article',
            'a."nom_article" as nom_article',
            'a."Unite" as unite',
            'pa.quantite',
            'a."PU" as pu',
            'pa.prix_total_ht',
            'pa.tva',
            'pa.total_ttc',
            'pa.localisation',
            'pa.description',
            'pa.nouv_prix',
            'pa.designation_article'
        ];

        if (includeDetails) {
            selectFields.push(`
                a."ID" as catalogue_id,
                a."Niveau_5__article" as niveau5_article,
                a."Niveau_6__detail_article" as niveau6_detail,
                a."nom_article" as nom_article_detail
            `);
        }

        // Handle case where blocId is null (articles directly in ouvrage/gbloc)
        // Convert lot to integer if it's a string representation of a number
        let lotId = null;
        if (lot !== null && lot !== undefined && lot !== '') {
            lotId = typeof lot === 'string' ? (lot.trim() === '' ? null : parseInt(lot, 10)) : lot;
            if (isNaN(lotId)) lotId = null;
        }

        // Build conditions and parameters dynamically based on what's provided
        let whereConditions = ['pl.id_projet = $1'];
        let queryParams = [projectId];
        let paramIndex = 2;

        // Add lot condition if lotId is provided
        if (lotId !== null) {
            whereConditions.push(`pl.id_lot = $${paramIndex}`);
            queryParams.push(lotId);
            paramIndex++;
        }

        // Add ouvrage condition (always required)
        whereConditions.push(`s.ouvrage = $${paramIndex}`);
        queryParams.push(ouvrageId);
        paramIndex++;

        // Add bloc condition
        if (blocId && blocId > 0) {
            // IMPORTANT: Only get articles that have this specific bloc ID
            // Exclude articles with bloc IS NULL (those belong directly to ouvrage)
            whereConditions.push(`s.bloc = $${paramIndex}`);
            whereConditions.push('s.bloc IS NOT NULL'); // Explicitly exclude NULL bloc
            queryParams.push(blocId);
            paramIndex++;
        } else {
            // When blocId is 0 or null, get articles directly in ouvrage (bloc IS NULL)
            whereConditions.push('s.bloc IS NULL');
        }

        // Add pagination parameters
        queryParams.push(limit, offset);
        const limitParam = paramIndex;
        const offsetParam = paramIndex + 1;

        // ✅ DEBUG: Log query parameters
        console.log('🔍 getBlocArticles query params:', {
            projectId,
            lotId,
            ouvrageId,
            blocId,
            whereConditions,
            queryParams
        });

        const query = `
            SELECT ${selectFields.join(', ')}
            FROM projet_article pa
            INNER JOIN structure s ON s.id_structure = pa.structure
            INNER JOIN ouvrage o ON o.id = s.ouvrage
            LEFT JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
            LEFT JOIN ${buildNormalizedArticlesSubquery('a')} ON a."ID" = pa.article
            WHERE ${whereConditions.join(' AND ')} AND pa.article IS NOT NULL
            ORDER BY pa.id
            LIMIT $${limitParam} OFFSET $${offsetParam}
        `;

        console.log('🔍 SQL Query:', query);

        const result = await pool.query(query, queryParams);

        console.log(`🔍 Query returned ${result.rows.length} articles for ouvrage=${ouvrageId}, bloc=${blocId}`);

        // Get total count for pagination (same conditions, no pagination params)
        const countParams = queryParams.slice(0, -2); // Remove limit and offset
        const countQuery = `
            SELECT COUNT(*) as total
            FROM projet_article pa
            INNER JOIN structure s ON s.id_structure = pa.structure
            INNER JOIN ouvrage o ON o.id = s.ouvrage
            LEFT JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
            WHERE ${whereConditions.join(' AND ')} AND pa.article IS NOT NULL
        `;
        const countResult = await pool.query(countQuery, countParams);

        return {
            articles: result.rows,
            pagination: {
                page,
                limit,
                total: parseInt(countResult.rows[0].total),
                totalPages: Math.ceil(countResult.rows[0].total / limit)
            }
        };
    }

    /**
     * Create a new GBloc without creating any projet_article rows
     * Links ouvrage to the project lot via projet_lot and creates structure entries only.
     */
    static async createGbloc(projectId, gblocData, userId = null) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { lot, gbloc: niveau3, gbloc_name } = gblocData;

            // Create or find the ouvrage record in ouvrage table
            let gblocId;
            const ouvrageCheck = await client.query(
                'SELECT id FROM ouvrage WHERE nom_ouvrage = $1',
                [gbloc_name || niveau3]
            );

            if (ouvrageCheck.rows.length > 0) {
                gblocId = ouvrageCheck.rows[0].id;
            } else {
                // Check if ouvrage table has auto-incrementing ID
                const ouvrageIdCheck = await client.query(
                    `SELECT column_default FROM information_schema.columns 
                     WHERE table_name='ouvrage' AND column_name='id'`
                );

                // Calculate ouvrage designation
                const DesignationHelper = require('../utils/designationHelper');
                const ouvrageDesignation = await DesignationHelper.getNextOuvrageDesignation(client, projectId);

                let insertOuvrage;
                if (ouvrageIdCheck.rows[0]?.column_default) {
                    // Auto-incrementing ID - get next from sequence
                    const proposedId = await getNextSequenceValue('ouvrage');
                    // Check for conflicts with bloc table and get safe ID
                    const safeOuvrageId = await getNextAvailableOuvrageId(proposedId);

                    insertOuvrage = await client.query(
                        'INSERT INTO ouvrage (id, nom_ouvrage, prix_total, designation) VALUES ($1, $2, $3, $4) RETURNING id',
                        [safeOuvrageId, gbloc_name || niveau3, 0, ouvrageDesignation]
                    );
                } else {
                    //Manual ID generation
                    const maxOuvrageId = await client.query('SELECT COALESCE(MAX(id), 0) as max_id FROM ouvrage');
                    const proposedId = maxOuvrageId.rows[0].max_id + 1;
                    // Check for conflicts with bloc table
                    const safeOuvrageId = await getNextAvailableOuvrageId(proposedId);

                    insertOuvrage = await client.query(
                        'INSERT INTO ouvrage (id, nom_ouvrage, prix_total, designation) VALUES ($1, $2, $3, $4) RETURNING id',
                        [safeOuvrageId, gbloc_name || niveau3, 0, ouvrageDesignation]
                    );
                }
                gblocId = insertOuvrage.rows[0].id;

                // ✅ Post-creation conflict check: Ensure ouvrage ID doesn't conflict with any bloc ID
                const safeOuvrageId = await getNextAvailableOuvrageId(gblocId);
                if (safeOuvrageId !== gblocId) {
                    console.warn(`⚠️ Post-creation conflict detected: ouvrage.id (${gblocId}) conflicts with bloc IDs`);

                    // Update ouvrage with the safe ID
                    await client.query(
                        'UPDATE ouvrage SET id = $1 WHERE id = $2',
                        [safeOuvrageId, gblocId]
                    );

                    console.log(`✅ Ouvrage ID changed: ${gblocId} → ${safeOuvrageId} to avoid conflict with bloc IDs`);
                    gblocId = safeOuvrageId;
                }
            }

            // Check if GBloc already exists for this combination
            const existing = await this.getGblocByKey(projectId, lot, gblocId);
            if (existing) {
                await client.query('COMMIT');
                return existing;
            }

            // Link ouvrage to project lot via projet_lot (no projet_article creation)
            let resolvedLotId = lot;
            if (lot && typeof lot === 'string') {
                const { ensureLotId } = require('../utils/lotHelper');
                resolvedLotId = await ensureLotId(client, lot);
            }
            if (resolvedLotId) {
                // Ensure projet_lot entry exists and update ouvrage.projet_lot
                const plRes = await client.query(
                    'SELECT id_projet_lot FROM projet_lot WHERE id_projet = $1 AND id_lot = $2',
                    [projectId, resolvedLotId]
                );
                let projetLotId;
                if (plRes.rows.length === 0) {
                    const lotInfo = await client.query('SELECT niveau_2 FROM niveau_2 WHERE id_niveau_2 = $1', [resolvedLotId]);
                    const lotName = lotInfo.rows[0]?.niveau_2 || `Lot ${resolvedLotId}`;
                    const designationLot = `Lot ${resolvedLotId}:`;
                    const seqCheck = await client.query("SELECT to_regclass('projet_lot_id_projet_lot_seq') as seq");
                    let nextId;
                    if (seqCheck.rows[0]?.seq) {
                        const sequenceResult = await client.query("SELECT nextval('projet_lot_id_projet_lot_seq')");
                        nextId = sequenceResult.rows[0].nextval;
                    } else {
                        const maxIdResult = await client.query('SELECT COALESCE(MAX(id_projet_lot), 0) + 1 as next_id FROM projet_lot');
                        nextId = maxIdResult.rows[0].next_id;
                    }
                    const newPL = await client.query(
                        'INSERT INTO projet_lot (id_projet_lot, id_projet, id_lot, designation_lot) VALUES ($1, $2, $3, $4) RETURNING id_projet_lot',
                        [nextId, projectId, resolvedLotId, designationLot]
                    );
                    projetLotId = newPL.rows[0].id_projet_lot;
                } else {
                    projetLotId = plRes.rows[0].id_projet_lot;
                }
                await client.query('UPDATE ouvrage SET projet_lot = $1 WHERE id = $2', [projetLotId, gblocId]);
            } else {
                // Ensure a projet_lot entry with NULL lot exists if needed, and link ouvrage
                const plNullRes = await client.query(
                    `SELECT id_projet_lot FROM projet_lot WHERE id_projet = $1 AND id_lot IS NULL`,
                    [projectId]
                );
                let projetLotId;
                if (plNullRes.rows.length === 0) {
                    const seqCheck = await client.query("SELECT to_regclass('projet_lot_id_projet_lot_seq') as seq");
                    let nextId;
                    if (seqCheck.rows[0]?.seq) {
                        const sequenceResult = await client.query("SELECT nextval('projet_lot_id_projet_lot_seq')");
                        nextId = sequenceResult.rows[0].nextval;
                    } else {
                        const maxIdResult = await client.query('SELECT COALESCE(MAX(id_projet_lot), 0) + 1 as next_id FROM projet_lot');
                        nextId = maxIdResult.rows[0].next_id;
                    }
                    const newPL = await client.query(
                        `INSERT INTO projet_lot (id_projet_lot, id_projet, id_lot, designation_lot) VALUES ($1, $2, NULL, $3) RETURNING id_projet_lot`,
                        [nextId, projectId, 'Sans lot']
                    );
                    projetLotId = newPL.rows[0].id_projet_lot;
                } else {
                    projetLotId = plNullRes.rows[0].id_projet_lot;
                }
                await client.query('UPDATE ouvrage SET projet_lot = $1 WHERE id = $2', [projetLotId, gblocId]);
            }

            // Create structure entry for the ouvrage (no bloc yet)
            const Structure = require('../models/Structure');
            await Structure.findOrCreate(gblocId, null, client);

            // Recalculate project's selling price after gbloc creation (inside transaction)
            // Even though no articles are added yet (total_ttc is NULL), this ensures consistency
            try {
                const Project = require('../models/Project');
                await Project.recalculatePrixVente(projectId, client);
                console.log('✅ Recalculated prix_vente after creating gbloc (no projet_article rows)');
            } catch (recalcError) {
                console.error('❌ Failed to recalculate prix_vente after creating gbloc:', recalcError);
                // Don't throw - the gbloc was created successfully
            }

            await client.query('COMMIT');

            // Return the created GBloc directly without querying (since we just created it)
            // Querying immediately after insert might fail if there are no articles yet
            const gblocName = gbloc_name || niveau3;
            return {
                id: gblocId,
                gbloc_id: String(gblocId),
                gbloc_name: gblocName,
                gbloc_label: gblocName,
                niveau_3: niveau3,
                lot: lot || null,
                project_id: projectId,
                bloc_count: 0,
                article_count: 0,
                total_ttc: 0,
                total_ht: 0,
                prix_total: 0
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Create a placeholder entry without an associated gbloc (placeholder projet_article row)
     * Note: niv_1 column has been removed from the database
     */
    static async createNiveau1Only(projectId, { lot }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Insert a placeholder projet_article row with only lot and project_id (no niv_1 anymore)
            const insertResult = await client.query(`
                INSERT INTO projet_article (
                    projet, 
                    lot, 
                    article,
                    quantite,
                    prix_unitaire,
                    prix_total_ht,
                    created_at,
                    updated_at
                ) VALUES (
                    $1, $2, 
                    'PLACEHOLDER', 
                    0, 0, 0, 
                    NOW(), NOW()
                ) RETURNING id, lot
            `, [projectId, lot]);

            await client.query('COMMIT');

            return {
                id: insertResult.rows[0].id,
                lot: insertResult.rows[0].lot,
                message: 'Placeholder entry created successfully'
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Create a new Bloc within a GBloc
     */
    static async createBloc(projectId, gblocKey, blocData, userId = null) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Parse gblocKey - can be object or string
            let lot, gblocId;
            if (typeof gblocKey === 'string') {
                const parts = gblocKey.split(':');
                // Format: lot:gbloc_id (no niv_1 anymore)
                lot = parts[0];
                gblocId = parseInt(parts[1], 10);
            } else {
                lot = gblocKey.lot;
                gblocId = gblocKey.gbloc_id || parseInt(gblocKey.gbloc, 10);
            }

            const { bloc: niveau4, bloc_name, unite, quantite, designation } = blocData;

            // Calculate bloc designation - use user-provided designation (allow duplicates)
            let blocDesignation = null;
            if (designation && typeof designation === 'string' && designation.trim()) {
                blocDesignation = designation.trim();
            }

            // Create or find the bloc record in bloc table
            let blocId;
            const blocCheck = await client.query(
                'SELECT id FROM bloc WHERE nom_bloc = $1',
                [bloc_name || niveau4]
            );

            if (blocCheck.rows.length > 0) {
                blocId = blocCheck.rows[0].id;
                // Update the existing bloc's designation, unite, quantite if provided
                if (blocDesignation || unite !== undefined || quantite !== undefined) {
                    await client.query(
                        'UPDATE bloc SET designation = COALESCE($1, designation), unite = COALESCE($2, unite), quantite = COALESCE($3, quantite) WHERE id = $4',
                        [blocDesignation, unite || null, quantite || null, blocId]
                    );
                }
            } else {
                // Check if bloc table has auto-incrementing ID
                const blocIdCheck = await client.query(
                    `SELECT column_default FROM information_schema.columns 
                     WHERE table_name='bloc' AND column_name='id'`
                );

                let insertBloc;
                if (blocIdCheck.rows[0]?.column_default) {
                    // Auto-incrementing ID - get next from sequence
                    const proposedId = await getNextSequenceValue('bloc');
                    // Check for conflicts with ouvrage table and get safe ID
                    const safeBlocId = await getNextAvailableBlocId(proposedId);

                    insertBloc = await client.query(
                        'INSERT INTO bloc (id, nom_bloc, unite, quantite, pu, pt, designation) VALUES ($1, $2, $3, $4, NULL, NULL, $5) RETURNING id',
                        [safeBlocId, bloc_name || niveau4, unite || null, quantite || null, blocDesignation]
                    );
                } else {
                    // Manual ID generation
                    const maxBlocId = await client.query('SELECT COALESCE(MAX(id), 0) as max_id FROM bloc');
                    const proposedId = maxBlocId.rows[0].max_id + 1;
                    // Check for conflicts with ouvrage table  
                    const safeBlocId = await getNextAvailableBlocId(proposedId);

                    insertBloc = await client.query(
                        'INSERT INTO bloc (id, nom_bloc, unite, quantite, pu, pt, designation) VALUES ($1, $2, $3, $4, NULL, NULL, $5) RETURNING id',
                        [safeBlocId, bloc_name || niveau4, unite || null, quantite || null, blocDesignation]
                    );
                }
                blocId = insertBloc.rows[0].id;
            }

            // Verify gblocId is valid
            if (!gblocId || isNaN(gblocId)) {
                throw new Error('GBloc ID is required and must be a valid integer');
            }

            // Check if Bloc already exists for this combination
            const existing = await this.getBlocByKey(projectId, lot, gblocId, blocId);
            if (existing) {
                await client.query('COMMIT');
                return existing;
            }

            // Link bloc to its ouvrage via structure (no projet_article creation)
            // Ensure projet_lot exists for the given lot and link the ouvrage
            if (lot !== undefined && lot !== null) {
                let resolvedLotId = lot;
                if (typeof lot === 'string') {
                    const { ensureLotId } = require('../utils/lotHelper');
                    resolvedLotId = await ensureLotId(client, lot);
                }
                if (resolvedLotId) {
                    const plRes = await client.query(
                        'SELECT id_projet_lot FROM projet_lot WHERE id_projet = $1 AND id_lot = $2',
                        [projectId, resolvedLotId]
                    );
                    let projetLotId;
                    if (plRes.rows.length === 0) {
                        const lotInfo = await client.query('SELECT niveau_2 FROM niveau_2 WHERE id_niveau_2 = $1', [resolvedLotId]);
                        const lotName = lotInfo.rows[0]?.niveau_2 || `Lot ${resolvedLotId}`;
                        const designationLot = `Lot ${resolvedLotId}:`;
                        const seqCheck = await client.query("SELECT to_regclass('projet_lot_id_projet_lot_seq') as seq");
                        let nextId;
                        if (seqCheck.rows[0]?.seq) {
                            const sequenceResult = await client.query("SELECT nextval('projet_lot_id_projet_lot_seq')");
                            nextId = sequenceResult.rows[0].nextval;
                        } else {
                            const maxIdResult = await client.query('SELECT COALESCE(MAX(id_projet_lot), 0) + 1 as next_id FROM projet_lot');
                            nextId = maxIdResult.rows[0].next_id;
                        }
                        const newPL = await client.query(
                            'INSERT INTO projet_lot (id_projet_lot, id_projet, id_lot, designation_lot) VALUES ($1, $2, $3, $4) RETURNING id_projet_lot',
                            [nextId, projectId, resolvedLotId, designationLot]
                        );
                        projetLotId = newPL.rows[0].id_projet_lot;
                    } else {
                        projetLotId = plRes.rows[0].id_projet_lot;
                    }
                    await client.query('UPDATE ouvrage SET projet_lot = $1 WHERE id = $2', [projetLotId, gblocId]);
                }
            }

            // Create structure entry for the ouvrage + bloc combination
            const Structure = require('../models/Structure');
            await Structure.findOrCreate(gblocId, blocId, client);

            // Recalculate project's selling price after bloc creation (inside transaction)
            // Even though no articles are added yet, this ensures consistency
            try {
                const Project = require('../models/Project');
                await Project.recalculatePrixVente(projectId, client);
                console.log('✅ Recalculated prix_vente after bloc creation');
            } catch (recalcError) {
                console.error('❌ Failed to recalculate prix_vente after creating bloc:', recalcError);
                // Don't throw - the bloc was created successfully
            }

            await client.query('COMMIT');

            // Return the created Bloc
            return await this.getBlocByKey(projectId, lot, gblocId, blocId);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get project totals aggregated from projet_article
     */
    static async getProjectTotals(projectId) {
        const query = `
            SELECT 
                COUNT(DISTINCT CASE WHEN lot IS NOT NULL THEN lot END) as lot_count,
                COUNT(DISTINCT CASE WHEN ouvrage IS NOT NULL THEN ouvrage END) as gbloc_count,
                COUNT(DISTINCT CASE WHEN bloc IS NOT NULL THEN bloc END) as bloc_count,
                COUNT(CASE WHEN article IS NOT NULL THEN 1 END) as article_count,
                COALESCE(SUM(total_ttc), 0)::float as total_ttc,
                COALESCE(SUM(prix_total_ht), 0)::float as total_ht
            FROM projet_article 
            WHERE projet = $1
        `;

        const result = await pool.query(query, [projectId]);
        return result.rows[0];
    }

    /**
     * Delete a GBloc and all its contents
     */
    static async deleteGbloc(projectId, gblocKey, userId = null) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Parse gblocKey - can be object or string
            let lot, gblocId;
            if (typeof gblocKey === 'string') {
                const parts = gblocKey.split(':');
                // Format: lot:gbloc_id (no niv_1 anymore)
                lot = parts[0];
                gblocId = parseInt(parts[1], 10);
            } else {
                lot = gblocKey.lot;
                gblocId = gblocKey.gbloc_id || parseInt(gblocKey.gbloc, 10);
            }

            if (!gblocId || isNaN(gblocId)) {
                throw new Error('GBloc ID is required and must be a valid integer');
            }

            // Get ouvrage name and lot information BEFORE deletion for event creation
            const ouvrageResult = await client.query('SELECT nom_ouvrage FROM ouvrage WHERE id = $1', [gblocId]);
            const ouvrageName = ouvrageResult.rows[0]?.nom_ouvrage || null;

            // Get lot information for the ouvrage before deletion using joins
            let ouvrageLot = null;
            try {
                const lotJoinRes = await client.query(
                    `SELECT pl.id_lot AS lot_id
                     FROM ouvrage o
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE pl.id_projet = $1 AND o.id = $2
                     LIMIT 1`,
                    [projectId, gblocId]
                );
                if (lotJoinRes.rows.length > 0 && lotJoinRes.rows[0].lot_id) {
                    ouvrageLot = lotJoinRes.rows[0].lot_id;
                }
            } catch { }

            // IMPORTANT: Preserve events by setting ouvrage to NULL instead of deleting them
            await client.query('UPDATE events SET ouvrage = NULL WHERE ouvrage = $1', [gblocId]);

            // Get bloc IDs associated with this ouvrage BEFORE deleting projet_article entries
            const blocIdsResult = await client.query(
                `SELECT DISTINCT s.bloc AS bloc
                 FROM structure s
                 INNER JOIN ouvrage o ON o.id = s.ouvrage
                 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND s.bloc IS NOT NULL`,
                [projectId, gblocId]
            );
            const blocIds = blocIdsResult.rows.map(row => row.bloc);

            // Preserve events by setting bloc to NULL for blocs in this ouvrage
            if (blocIds.length > 0) {
                await client.query(
                    'UPDATE events SET bloc = NULL WHERE bloc = ANY($1)',
                    [blocIds]
                );
            }

            // Delete all projet_article rows for this GBloc
            const result = await client.query(
                `DELETE FROM projet_article pa 
                 USING structure s, ouvrage o, projet_lot pl
                 WHERE pa.structure = s.id_structure 
                   AND s.ouvrage = o.id
                   AND o.projet_lot = pl.id_projet_lot
                   AND pl.id_projet = $1
                   AND s.ouvrage = $2`,
                [projectId, gblocId]
            );

            // Delete all structure rows for this ouvrage to satisfy FK before deleting ouvrage
            await client.query('DELETE FROM structure WHERE ouvrage = $1', [gblocId]);

            // Delete orphan blocs ONLY within this project scope
            if (blocIds.length > 0) {
                await client.query(`
                    DELETE FROM bloc b 
                    WHERE b.id = ANY($1) AND NOT EXISTS (
                        SELECT 1 FROM structure s_other 
                        WHERE s_other.bloc = b.id
                    )
                `, [blocIds]);
            }

            // Delete the ouvrage itself
            const deleteResult = await client.query('DELETE FROM ouvrage WHERE id = $1 RETURNING id', [gblocId]);

            // Create deletion event after successful deletion (before commit)
            if (deleteResult.rowCount > 0 && ouvrageName && userId) {
                try {
                    const EventNotificationService = require('../services/EventNotificationService');
                    await EventNotificationService.gblocDeleted(projectId, gblocId, userId, ouvrageName, ouvrageLot);
                    console.log('✅ Ouvrage deletion event created successfully');
                } catch (eventError) {
                    console.error('❌ Failed to create ouvrage deletion event:', eventError);
                    // Don't throw - the ouvrage was deleted successfully
                }
            }

            // Skip placeholder insertion tied to projet_article.lot; schema may not have this column

            await client.query('COMMIT');
            return result.rowCount > 0;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Delete a Bloc and all its articles
     */
    static async deleteBloc(projectId, blocKey, userId = null) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Parse blocKey - can be object or string
            let lot, gblocId, blocId;
            if (typeof blocKey === 'string') {
                const parts = blocKey.split(':');
                // Format: lot:gbloc_id:bloc_id (no niv_1 anymore)
                lot = parts[0];
                gblocId = parseInt(parts[1], 10);
                blocId = parseInt(parts[2], 10);
            } else {
                lot = blocKey.lot;
                gblocId = blocKey.gbloc_id || parseInt(blocKey.gbloc, 10);
                blocId = blocKey.bloc_id || parseInt(blocKey.bloc, 10);
            }

            if (!blocId || isNaN(blocId)) {
                throw new Error('Bloc ID is required and must be a valid integer');
            }

            // Get bloc name before deletion for event creation
            const blocNameResult = await client.query('SELECT nom_bloc FROM bloc WHERE id = $1', [blocId]);
            const blocName = blocNameResult.rows[0]?.nom_bloc || null;

            // ✅ FIX: Get lot information before deletion for event creation
            let blocLot = null;
            let resolvedLotName = lot; // Use provided lot if available
            if (gblocId && !isNaN(gblocId)) {
                // Get lot via joins before deletion
                const lotResult = await client.query(
                    `SELECT DISTINCT pl.id_lot AS lot_id
                     FROM structure s
                     INNER JOIN ouvrage o ON o.id = s.ouvrage
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE pl.id_projet = $1 AND s.bloc = $2 AND s.ouvrage = $3 AND pl.id_lot IS NOT NULL
                     LIMIT 1`,
                    [projectId, blocId, gblocId]
                );
                if (lotResult.rows.length > 0) {
                    blocLot = lotResult.rows[0].lot_id;
                    // If lot is an ID, resolve it to a name
                    if (typeof blocLot === 'number' || (typeof blocLot === 'string' && /^\d+$/.test(blocLot))) {
                        const lotId = typeof blocLot === 'number' ? blocLot : parseInt(blocLot, 10);
                        try {
                            const lotNameRes = await client.query('SELECT niveau_2 FROM niveau_2 WHERE id_niveau_2 = $1', [lotId]);
                            if (lotNameRes.rows.length > 0 && lotNameRes.rows[0].niveau_2) {
                                resolvedLotName = lotNameRes.rows[0].niveau_2;
                            } else {
                                // Try alternative column name
                                try {
                                    const lotNameRes2 = await client.query('SELECT "Niveau_2__lot" FROM niveau_2 WHERE id_niveau_2 = $1', [lotId]);
                                    if (lotNameRes2.rows.length > 0 && lotNameRes2.rows[0].Niveau_2__lot) {
                                        resolvedLotName = lotNameRes2.rows[0].Niveau_2__lot;
                                    }
                                } catch { }
                            }
                        } catch (lotError) {
                            console.warn('⚠️ Failed to resolve lot name for bloc deletion:', lotError.message);
                        }
                    } else {
                        resolvedLotName = blocLot; // Already a name
                    }
                }
            } else if (!resolvedLotName) {
                // Fallback: get lot without ouvrage context
                const lotResult = await client.query(
                    'SELECT DISTINCT lot FROM projet_article WHERE projet = $1 AND bloc = $2 AND lot IS NOT NULL LIMIT 1',
                    [projectId, blocId]
                );
                if (lotResult.rows.length > 0) {
                    blocLot = lotResult.rows[0].lot;
                    // Resolve if it's an ID
                    if (typeof blocLot === 'number' || (typeof blocLot === 'string' && /^\d+$/.test(blocLot))) {
                        const lotId = typeof blocLot === 'number' ? blocLot : parseInt(blocLot, 10);
                        try {
                            const lotNameRes = await client.query('SELECT niveau_2 FROM niveau_2 WHERE id_niveau_2 = $1', [lotId]);
                            if (lotNameRes.rows.length > 0 && lotNameRes.rows[0].niveau_2) {
                                resolvedLotName = lotNameRes.rows[0].niveau_2;
                            } else {
                                try {
                                    const lotNameRes2 = await client.query('SELECT "Niveau_2__lot" FROM niveau_2 WHERE id_niveau_2 = $1', [lotId]);
                                    if (lotNameRes2.rows.length > 0 && lotNameRes2.rows[0].Niveau_2__lot) {
                                        resolvedLotName = lotNameRes2.rows[0].Niveau_2__lot;
                                    }
                                } catch { }
                            }
                        } catch (lotError) {
                            console.warn('⚠️ Failed to resolve lot name for bloc deletion:', lotError.message);
                        }
                    } else {
                        resolvedLotName = blocLot;
                    }
                }
            }

            // IMPORTANT: Preserve events by setting bloc to NULL instead of deleting them
            await client.query('UPDATE events SET bloc = NULL WHERE bloc = $1', [blocId]);

            // ✅ CRITICAL FIX: Scope deletion by ouvrage to prevent cross-ouvrage deletion
            // Only delete articles that belong to BOTH this bloc AND this specific ouvrage
            // This ensures that when duplicating an ouvrage, each ouvrage has independent blocs
            let deleteArticlesResult;
            if (gblocId && !isNaN(gblocId)) {
                // Delete only articles in this specific ouvrage + bloc combination via structure join
                deleteArticlesResult = await client.query(
                    `DELETE FROM projet_article pa
                     USING structure s, ouvrage o, projet_lot pl
                     WHERE pa.structure = s.id_structure
                       AND s.ouvrage = o.id
                       AND o.projet_lot = pl.id_projet_lot
                       AND pl.id_projet = $1
                       AND s.ouvrage = $2
                       AND s.bloc = $3`,
                    [projectId, gblocId, blocId]
                );
                console.log(`[HIERARCHY DELETE BLOC] Deleted ${deleteArticlesResult.rowCount} projet_article entries for bloc ${blocId} in ouvrage ${gblocId}`);

                const deleteStructuresResult = await client.query(
                    `DELETE FROM structure s
                     USING ouvrage o, projet_lot pl
                     WHERE s.ouvrage = o.id
                       AND o.projet_lot = pl.id_projet_lot
                       AND pl.id_projet = $1
                       AND s.ouvrage = $2
                       AND s.bloc = $3`,
                    [projectId, gblocId, blocId]
                );
                console.log(`[HIERARCHY DELETE BLOC] Deleted ${deleteStructuresResult.rowCount} structure entries for bloc ${blocId} in ouvrage ${gblocId}`);

                const remainingStructsCheck = await client.query(
                    `SELECT COUNT(DISTINCT s.ouvrage) as ouvrage_count
                     FROM structure s
                     INNER JOIN ouvrage o ON o.id = s.ouvrage
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE pl.id_projet = $1 AND s.bloc = $2`,
                    [projectId, blocId]
                );
                const remainingCount = parseInt(remainingStructsCheck.rows[0]?.ouvrage_count || 0, 10);

                if (remainingCount > 0) {
                    console.log(`[HIERARCHY DELETE BLOC] Bloc ${blocId} still referenced by ${remainingCount} ouvrage(s) - keeping bloc record`);
                    await client.query('COMMIT');
                    return true;
                }
            } else {
                // Fallback: If gblocId not provided, check if bloc is used by multiple ouvrages
                const ouvrageCheck = await client.query(
                    `SELECT COUNT(DISTINCT s.ouvrage) as ouvrage_count
                     FROM structure s
                     INNER JOIN ouvrage o ON o.id = s.ouvrage
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE pl.id_projet = $1 AND s.bloc = $2`,
                    [projectId, blocId]
                );
                const ouvrageCount = parseInt(ouvrageCheck.rows[0]?.ouvrage_count || 0, 10);

                if (ouvrageCount > 1) {
                    // Bloc is used by multiple ouvrages - require ouvrage context
                    await client.query('ROLLBACK');
                    throw new Error(`Bloc ${blocId} is used by ${ouvrageCount} ouvrages. Please specify ouvrage (gblocId) in blocKey.`);
                } else if (ouvrageCount === 1) {
                    // Only one ouvrage uses this bloc - safe to delete all articles
                    deleteArticlesResult = await client.query(
                        `DELETE FROM projet_article pa
                         USING structure s, ouvrage o, projet_lot pl
                         WHERE pa.structure = s.id_structure
                           AND s.ouvrage = o.id
                           AND o.projet_lot = pl.id_projet_lot
                           AND pl.id_projet = $1
                           AND s.bloc = $2`,
                        [projectId, blocId]
                    );
                    console.log(`[HIERARCHY DELETE BLOC] Deleted ${deleteArticlesResult.rowCount} projet_article entries for bloc ${blocId} (single ouvrage)`);

                    const deleteStructuresResult = await client.query(
                        `DELETE FROM structure s
                         USING ouvrage o, projet_lot pl
                         WHERE s.ouvrage = o.id
                           AND o.projet_lot = pl.id_projet_lot
                           AND pl.id_projet = $1
                           AND s.bloc = $2`,
                        [projectId, blocId]
                    );
                    console.log(`[HIERARCHY DELETE BLOC] Deleted ${deleteStructuresResult.rowCount} structure entries for bloc ${blocId} (single ouvrage)`);
                } else {
                    // No ouvrage uses this bloc - delete all articles (shouldn't happen, but handle it)
                    deleteArticlesResult = await client.query(
                        `DELETE FROM projet_article pa
                         USING structure s, ouvrage o, projet_lot pl
                         WHERE pa.structure = s.id_structure
                           AND s.ouvrage = o.id
                           AND o.projet_lot = pl.id_projet_lot
                           AND pl.id_projet = $1
                           AND s.bloc = $2`,
                        [projectId, blocId]
                    );
                    console.log(`[HIERARCHY DELETE BLOC] Deleted ${deleteArticlesResult.rowCount} projet_article entries for bloc ${blocId} (no ouvrage context)`);

                    const deleteStructuresResult = await client.query(
                        `DELETE FROM structure s
                         USING ouvrage o, projet_lot pl
                         WHERE s.ouvrage = o.id
                           AND o.projet_lot = pl.id_projet_lot
                           AND pl.id_projet = $1
                           AND s.bloc = $2`,
                        [projectId, blocId]
                    );
                    console.log(`[HIERARCHY DELETE BLOC] Deleted ${deleteStructuresResult.rowCount} structure entries for bloc ${blocId} (no ouvrage context)`);
                }
            }

            // Delete the bloc record itself
            const deleteBlocResult = await client.query('DELETE FROM bloc WHERE id = $1 RETURNING id', [blocId]);
            console.log(`[HIERARCHY DELETE BLOC] Deleted bloc record, rowCount: ${deleteBlocResult.rowCount}`);

            // Always recalculate project's selling price after bloc deletion (inside transaction)
            // Even if no articles were deleted, the bloc deletion itself might affect totals
            try {
                const Project = require('../models/Project');
                await Project.recalculatePrixVente(projectId, client);
                console.log(`✅ Recalculated prix_vente after bloc deletion (deleted ${deleteArticlesResult.rowCount} articles, ${deleteBlocResult.rowCount} bloc)`);
            } catch (recalcError) {
                console.error('❌ Failed to recalculate prix_vente after deleting bloc:', recalcError);
                // Don't throw - the bloc was deleted successfully
            }

            await client.query('COMMIT');

            // Create deletion event after successful deletion
            if ((deleteArticlesResult.rowCount > 0 || deleteBlocResult.rowCount > 0) && blocName && userId) {
                setImmediate(async () => {
                    try {
                        const EventNotificationService = require('../services/EventNotificationService');
                        // ✅ FIX: Pass ouvrage ID (gblocId) and resolved lot name to blocDeleted
                        await EventNotificationService.blocDeleted(projectId, blocId, userId, blocName, resolvedLotName || lot || null, gblocId || null);
                        console.log('✅ Bloc deletion event created successfully');
                    } catch (eventError) {
                        console.error('❌ Failed to create bloc deletion event:', eventError);
                    }
                });
            }

            return deleteBlocResult.rowCount > 0;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = HierarchyService;
