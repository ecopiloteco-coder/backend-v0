const pool = require('../../config/db');
const EventNotificationService = require('../services/EventNotificationService');
const NiveauService = require('../services/NiveauService');
const { ensureLotId } = require('../utils/lotHelper');
const ProjetLot = require('./ProjetLot');
const Structure = require('./Structure');

const ARTICLE_HIERARCHY_JOIN = NiveauService.getArticleHierarchyJoin('a');
const NORMALIZED_ARTICLES_SUBQUERY = `
    (
        SELECT
            a.*,
            ${NiveauService.getArticleHierarchySelectFields('a')}
        FROM articles a
        ${ARTICLE_HIERARCHY_JOIN}
    ) normalized_articles
`;

class ProjectArticle {
    // Anchor methods removed as they are replaced by ProjetLot, Ouvrage, and Structure tables

    /**
     * Generate hierarchical article designation based on parent bloc designation
     * @param {Object} dbClient - Database client
     * @param {number} projectId - Project ID
     * @param {number} blocId - Bloc ID (can be null for articles under ouvrage)
     * @param {number} ouvrageId - Ouvrage ID
     * @returns {Promise<string|null>} Generated designation or null
     */
    static async generateArticleDesignation(dbClient, projectId, blocId, ouvrageId) {
        try {
            // If bloc exists, use bloc designation as prefix
            if (blocId) {
                const blocRes = await dbClient.query(
                    'SELECT designation FROM bloc WHERE id = $1',
                    [blocId]
                );

                if (blocRes.rows.length > 0 && blocRes.rows[0].designation) {
                    const blocDesignation = blocRes.rows[0].designation;

                    // Find max article number under this bloc
                    // Use structure table to find articles belonging to this bloc
                    const maxRes = await dbClient.query(`
                        SELECT pa.designation_article
                        FROM projet_article pa
                        INNER JOIN structure s ON s.id_structure = pa.structure
                        WHERE s.bloc = $1 
                          AND pa.designation_article LIKE $2
                          AND pa.designation_article ~ $3
                        ORDER BY pa.designation_article DESC
                        LIMIT 50
                    `, [
                        blocId,
                        `${blocDesignation}.%`,
                        `^${blocDesignation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.\\d+$`
                    ]);

                    let nextNumber = 1;
                    if (maxRes.rows.length > 0) {
                        // Find the highest number
                        let maxNumber = 0;
                        for (const row of maxRes.rows) {
                            const designation = row.designation_article;
                            if (designation && designation.startsWith(blocDesignation + '.')) {
                                const parts = designation.split('.');
                                const lastPart = parts[parts.length - 1];
                                const num = parseInt(lastPart, 10);
                                if (!isNaN(num) && num > maxNumber) {
                                    maxNumber = num;
                                }
                            }
                        }
                        nextNumber = maxNumber + 1;
                    }

                    return `${blocDesignation}.${nextNumber}`;
                }
            } else if (ouvrageId) {
                // If no bloc, try to use ouvrage designation as prefix
                const ouvrageRes = await dbClient.query(
                    'SELECT designation FROM ouvrage WHERE id = $1',
                    [ouvrageId]
                );

                if (ouvrageRes.rows.length > 0 && ouvrageRes.rows[0].designation) {
                    const ouvrageDesignation = ouvrageRes.rows[0].designation;

                    // Find max article number under this ouvrage (without bloc)
                    const maxRes = await dbClient.query(`
                        SELECT pa.designation_article
                        FROM projet_article pa
                        INNER JOIN structure s ON s.id_structure = pa.structure
                        WHERE s.ouvrage = $1 
                          AND s.bloc IS NULL
                          AND pa.designation_article LIKE $2
                          AND pa.designation_article ~ $3
                        ORDER BY pa.designation_article DESC
                        LIMIT 50
                    `, [
                        ouvrageId,
                        `${ouvrageDesignation}.%`,
                        `^${ouvrageDesignation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.\\d+$`
                    ]);

                    let nextNumber = 1;
                    if (maxRes.rows.length > 0) {
                        let maxNumber = 0;
                        for (const row of maxRes.rows) {
                            const designation = row.designation_article;
                            if (designation && designation.startsWith(ouvrageDesignation + '.')) {
                                const parts = designation.split('.');
                                const lastPart = parts[parts.length - 1];
                                const num = parseInt(lastPart, 10);
                                if (!isNaN(num) && num > maxNumber) {
                                    maxNumber = num;
                                }
                            }
                        }
                        nextNumber = maxNumber + 1;
                    }

                    return `${ouvrageDesignation}.${nextNumber}`;
                }
            }

            return null; // No auto-designation possible
        } catch (error) {
            console.error('Error generating article designation:', error);
            return null; // Fallback to default behavior
        }
    }

    static async upgradeLotToOuvrage(projectId, lotInput, ouvrageId, client = null) {
        const dbClient = client || await pool.connect();
        try {
            const lotId = await ensureLotId(dbClient, lotInput);
            const lotAnchorId = await this.ensureLotAnchorRow(projectId, lotId, dbClient);
            const upd = await dbClient.query(
                `UPDATE projet_article SET ouvrage = $1 
                 WHERE id = $2 RETURNING id`,
                [ouvrageId, lotAnchorId]
            );
            return upd.rows[0].id;
        } finally {
            if (!client) dbClient.release();
        }
    }

    static async ensureOuvrageAnchorRow(projectId, lotInput, ouvrageId, client = null) {
        const dbClient = client || await pool.connect();
        try {
            const lotId = await ensureLotId(dbClient, lotInput);

            // Check if lot column exists
            const lotColCheck = await dbClient.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'projet_article' AND column_name = 'lot'
            `);
            const hasLotCol = lotColCheck.rows.length > 0;

            let existing;
            if (hasLotCol) {
                existing = await dbClient.query(
                    `SELECT id FROM projet_article 
                     WHERE projet = $1 AND lot = $2 AND ouvrage = $3 AND bloc IS NULL 
                     ORDER BY id LIMIT 1`,
                    [projectId, lotId, ouvrageId]
                );
            } else {
                existing = await dbClient.query(
                    `SELECT id FROM projet_article 
                     WHERE projet = $1 AND ouvrage = $2 AND bloc IS NULL 
                     ORDER BY id LIMIT 1`,
                    [projectId, ouvrageId]
                );
            }

            if (existing.rows.length > 0) {
                return existing.rows[0].id;
            }
            const lotUpgradedId = await this.upgradeLotToOuvrage(projectId, lotId, ouvrageId, dbClient);
            return lotUpgradedId;
        } finally {
            if (!client) dbClient.release();
        }
    }

    static async ensureBlocAnchorRow(projectId, lotInput, ouvrageId, blocId, client = null) {
        const dbClient = client || await pool.connect();
        try {
            const lotId = await ensureLotId(dbClient, lotInput);

            // Check if lot column exists
            const lotColCheck = await dbClient.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'projet_article' AND column_name = 'lot'
            `);
            const hasLotCol = lotColCheck.rows.length > 0;

            let existing;
            if (hasLotCol) {
                existing = await dbClient.query(
                    `SELECT id FROM projet_article 
                     WHERE projet = $1 AND lot = $2 AND ouvrage = $3 AND bloc = $4 
                     ORDER BY id LIMIT 1`,
                    [projectId, lotId, ouvrageId, blocId]
                );
            } else {
                existing = await dbClient.query(
                    `SELECT id FROM projet_article 
                     WHERE projet = $1 AND ouvrage = $2 AND bloc = $3 
                     ORDER BY id LIMIT 1`,
                    [projectId, ouvrageId, blocId]
                );
            }

            if (existing.rows.length > 0) {
                return existing.rows[0].id;
            }
            const idCheck = await dbClient.query(
                `SELECT column_default FROM information_schema.columns 
                 WHERE table_name='projet_article' AND column_name='id'`
            );
            if (idCheck.rows[0]?.column_default) {
                const ins = await dbClient.query(
                    `INSERT INTO projet_article (projet, lot, ouvrage, bloc, article)
                     VALUES ($1, $2, $3, $4, NULL) RETURNING id`,
                    [projectId, lotId, ouvrageId, blocId]
                );
                return ins.rows[0].id;
            } else {
                const maxId = await dbClient.query('SELECT COALESCE(MAX(id), 0) as max_id FROM projet_article');
                const nextId = maxId.rows[0].max_id + 1;
                const ins = await dbClient.query(
                    `INSERT INTO projet_article (id, projet, lot, ouvrage, bloc, article)
                     VALUES ($1, $2, $3, $4, $5, NULL) RETURNING id`,
                    [nextId, projectId, lotId, ouvrageId, blocId]
                );
                return ins.rows[0].id;
            }
        } finally {
            if (!client) dbClient.release();
        }
    }

    static async addArticleToOuvrage(projectId, lotInput, ouvrageId, catalogueId, quantity = 1, fields = {}, client = null) {
        return this.addArticleToBloc(projectId, lotInput, ouvrageId, null, catalogueId, quantity, fields, client);
    }

    static async addArticleToBloc(projectId, lotInput, ouvrageId, blocId, catalogueId, quantity = 1, fields = {}, client = null) {
        const dbClient = client || await pool.connect();
        const shouldRelease = !client;
        try {
            if (shouldRelease) await dbClient.query('BEGIN');

            // 1. Resolve Lot
            let lotId = await ensureLotId(dbClient, lotInput);
            if (!lotId && ouvrageId) {
                // Try to resolve lot from ouvrage -> projet_lot
                try {
                    const res = await dbClient.query(
                        'SELECT pl.id_lot FROM projet_lot pl JOIN ouvrage o ON o.projet_lot = pl.id_projet_lot WHERE o.id = $1',
                        [ouvrageId]
                    );
                    if (res.rows.length > 0) lotId = res.rows[0].id_lot;
                } catch (e) { }
            }
            if (!lotId) throw new Error('Lot identifier required');

            // 2. Ensure ProjetLot
            const projetLotId = await ProjetLot.findOrCreate(projectId, lotId, dbClient);

            // 3. Ensure Ouvrage is linked to ProjetLot
            if (ouvrageId) {
                const ouvCheck = await dbClient.query('SELECT projet_lot FROM ouvrage WHERE id = $1', [ouvrageId]);
                if (ouvCheck.rows.length > 0) {
                    if (ouvCheck.rows[0].projet_lot === null) {
                        await dbClient.query('UPDATE ouvrage SET projet_lot = $1 WHERE id = $2', [projetLotId, ouvrageId]);
                    }
                }
            }

            // 4. Ensure Structure
            const structureId = await Structure.findOrCreate(ouvrageId, blocId, dbClient);

            // 5. Validate Hierarchy (Optional check?)
            // await this.validateHierarchy(...) 

            // 6. Create Article
            const catalogueResult = await dbClient.query(
                `SELECT * FROM ${NORMALIZED_ARTICLES_SUBQUERY} WHERE "ID" = $1`,
                [catalogueId]
            );
            if (catalogueResult.rows.length === 0) {
                throw new Error('Catalogue article not found');
            }
            const catalogue = catalogueResult.rows[0];
            const pu = fields.nouv_prix ?? (catalogue["PU"] || 0);
            const tva = fields.tva ?? 0;
            const prixTotalHt = pu * quantity;
            const totalTtc = prixTotalHt * (1 + tva / 100);

            // Check if lot column exists before including it
            const lotColCheck = await dbClient.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'projet_article' AND column_name = 'lot'
            `);
            const hasLotCol = lotColCheck.rows.length > 0;

            // Auto-generate designation if not provided by user
            let articleDesignation = fields.designation_article;
            if (!articleDesignation) {
                // Try to auto-generate based on bloc or ouvrage designation
                articleDesignation = await ProjectArticle.generateArticleDesignation(
                    dbClient, projectId, blocId, ouvrageId
                );
            }
            // Fallback to catalogue ID if auto-generation didn't work
            if (!articleDesignation) {
                articleDesignation = catalogueId;
            }

            const articleData = {
                projet: projectId,
                ouvrage: ouvrageId,
                bloc: blocId,
                structure: structureId,
                article: catalogueId,
                quantite: quantity,
                pu,
                prix_total_ht: prixTotalHt,
                tva,
                total_ttc: totalTtc,
                localisation: fields.localisation ?? null,
                description: fields.description ?? null,
                nouv_prix: fields.nouv_prix ?? null,
                designation_article: articleDesignation
            };

            // Only include lot if the column exists
            if (hasLotCol) {
                articleData.lot = lotId;
            }

            // ✅ FIX: Check if article already exists in this structure
            const existingCheck = await dbClient.query(
                'SELECT id, quantite FROM projet_article WHERE structure = $1 AND article = $2',
                [structureId, catalogueId]
            );

            let created;
            if (existingCheck.rows.length > 0) {
                // Article already exists - update quantity instead
                const existing = existingCheck.rows[0];
                const newQuantity = existing.quantite + quantity;
                const newPrixTotalHt = newQuantity * pu;
                const newTotalTtc = newPrixTotalHt * (1 + (tva / 100));

                const updated = await dbClient.query(
                    `UPDATE projet_article 
                     SET quantite = $1, 
                         prix_total_ht = $2,
                         total_ttc = $3
                     WHERE id = $4 
                     RETURNING *`,
                    [newQuantity, newPrixTotalHt, newTotalTtc, existing.id]
                );
                created = updated.rows[0];
                console.log(`✅ Updated existing article quantity: ${existing.quantite} → ${newQuantity}`);
            } else {
                // Article doesn't exist - create new
                created = await this.create(articleData, dbClient);
            }

            if (shouldRelease) await dbClient.query('COMMIT');
            return created;
        } catch (e) {
            if (shouldRelease) await dbClient.query('ROLLBACK');
            throw e;
        } finally {
            if (shouldRelease) dbClient.release();
        }
    }

    static async deleteOrClear(id, client = null) {
        const dbClient = client || await pool.connect();
        const shouldRelease = !client;
        try {
            if (shouldRelease) await dbClient.query('BEGIN');

            // Simply delete the article. Structure table preserves the hierarchy node.
            const deleted = await dbClient.query(
                'DELETE FROM projet_article WHERE id = $1 RETURNING *',
                [id]
            );

            const Project = require('./Project');
            const row = deleted.rows[0];
            if (row) {
                try { await Project.recalculatePrixVente(row.projet, dbClient); } catch { }
            }

            if (shouldRelease) await dbClient.query('COMMIT');
            return deleted.rows[0];
        } catch (e) {
            if (shouldRelease) await dbClient.query('ROLLBACK');
            throw e;
        } finally {
            if (shouldRelease) dbClient.release();
        }
    }
    /**
     * Create a new projet_article entry with proper hierarchy validation
     */
    static async create(articleData, client = null) {
        const dbClient = client || await pool.connect();
        const useTransaction = !client;

        try {
            if (useTransaction) await dbClient.query('BEGIN');

            const {
                projet,
                lot: lotInput,
                ouvrage: ouvrageFromData,
                gbloc: gblocFromData,
                g_bloc: g_blocFromData,
                bloc,
                structure: structureIdFromData,
                article,
                niveau_5_article,
                niveau_6_detail_article,
                unite,
                quantite,
                pu,
                prix_total_ht,
                tva,
                total_ttc,
                localisation,
                description,
                nouv_prix,
                designation_article,
                designation_lot: providedDesignationLot
            } = articleData;

            // Support both ouvrage, gbloc and g_bloc field names
            const ouvrage = ouvrageFromData ?? gblocFromData ?? g_blocFromData;

            // Get ouvrage_id and bloc_id if provided as names
            let gblocId = ouvrage;
            let blocId = bloc;

            if (ouvrage && typeof ouvrage === 'string') {
                const ouvrageResult = await dbClient.query(
                    'SELECT id FROM ouvrage WHERE nom_ouvrage = $1',
                    [ouvrage]
                );
                if (ouvrageResult.rows.length === 0) {
                    throw new Error(`Ouvrage '${ouvrage}' not found`);
                }
                gblocId = ouvrageResult.rows[0].id;
            }

            if (bloc && typeof bloc === 'string') {
                if (!gblocId || (typeof gblocId !== 'number')) {
                    throw new Error(`Cannot resolve bloc by name '${bloc}' without ouvrage/gbloc ID. Please provide bloc ID instead.`);
                }

                // Find bloc by name within the specific ouvrage
                const blocResult = await dbClient.query(
                    `SELECT DISTINCT b.id 
                     FROM bloc b
                     INNER JOIN structure s ON s.bloc = b.id
                     INNER JOIN ouvrage o ON o.id = s.ouvrage
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     INNER JOIN projet_article pa ON pa.structure = s.id_structure
                     WHERE b.nom_bloc = $1 AND s.ouvrage = $2 AND pl.id_projet = $3
                     LIMIT 1`,
                    [bloc, gblocId, projet]
                );
                if (blocResult.rows.length === 0) {
                    throw new Error(`Bloc '${bloc}' not found in ouvrage ${gblocId} for project ${projet}`);
                }
                blocId = blocResult.rows[0].id;
            }

            if (!gblocId && structureIdFromData) {
                const sRes = await dbClient.query('SELECT ouvrage, bloc FROM structure WHERE id_structure = $1', [structureIdFromData]);
                if (sRes.rows.length > 0) {
                    gblocId = sRes.rows[0].ouvrage || null;
                    blocId = sRes.rows[0].bloc || null;
                }
            }

            // ✅ STRICT HIERARCHY VALIDATION
            // Ensure that if a bloc is specified, it actually belongs to the specified ouvrage in this project
            if (blocId && gblocId) {
                const relationshipCheck = await dbClient.query(
                    `SELECT 1
                     FROM structure s
                     INNER JOIN ouvrage o ON o.id = s.ouvrage
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND s.bloc = $3 
                     LIMIT 1`,
                    [projet, gblocId, blocId]
                );

                if (relationshipCheck.rows.length === 0) {
                    // Double check if the bloc exists at all
                    const blocExists = await dbClient.query('SELECT id FROM bloc WHERE id = $1', [blocId]);
                    if (blocExists.rows.length === 0) {
                        throw new Error(`Bloc ${blocId} does not exist`);
                    }
                    throw new Error(`Bloc ${blocId} does not belong to Ouvrage ${gblocId} in this project`);
                }
            }

            // ✅ VALIDATION: Check for article designation conflict if user provided one
            if (designation_article && String(designation_article).trim()) {
                const DesignationHelper = require('../utils/designationHelper');
                const isAvailable = await DesignationHelper.checkArticleDesignationAvailability(
                    dbClient,
                    projet,
                    blocId,
                    gblocId,
                    designation_article,
                    null,
                    structureIdFromData
                );
                if (!isAvailable) {
                    throw new Error(`La désignation d'article "${designation_article}" existe déjà dans ce contexte.`);
                }
            }

            // Validate hierarchy according to allowed combinations (no niv_1 anymore)
            this.validateHierarchy({ lot: lotInput, ouvrage: gblocId, bloc: blocId, article });

            let finalLotId = null;
            const structureColCheck = await dbClient.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'projet_article' AND column_name = 'structure'
            `);
            const hasStructureId = structureColCheck.rows.length > 0;
            if (!hasStructureId) {
                finalLotId = await ensureLotId(dbClient, lotInput);
            }

            // Use provided lot designation or NULL - don't automatically calculate
            let lotDesignation = providedDesignationLot || null;

            // Check for ID generation requirement
            const idCheck = await dbClient.query(`
                SELECT column_default FROM information_schema.columns 
                WHERE table_name='projet_article' AND column_name='id'
            `);

            // Check if designation_lot column exists
            const designationLotCheck = await dbClient.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'projet_article' AND column_name = 'designation_lot'
            `);
            const hasDesignationLot = designationLotCheck.rows.length > 0;
            // Check if projet column exists (new schema may omit it)
            const projetColCheck = await dbClient.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'projet_article' AND column_name = 'projet'
            `);
            const hasProjetCol = projetColCheck.rows.length > 0;
            // Check if lot column exists (new schema may omit it)
            const lotColCheck = await dbClient.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'projet_article' AND column_name = 'lot'
            `);
            const hasLotCol = lotColCheck.rows.length > 0;

            let insertQuery, params;
            if (idCheck.rows[0]?.column_default) {
                if (hasStructureId) {
                    if (hasDesignationLot) {
                        if (hasProjetCol) {
                            insertQuery = `
                                INSERT INTO projet_article (
                                    projet, structure, article, 
                                    quantite, prix_total_ht, tva, total_ttc,
                                    localisation, description, nouv_prix,
                                    designation_article, designation_lot
                                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                                RETURNING *
                            `;
                            params = [
                                projet, structureIdFromData, article,
                                quantite, prix_total_ht, tva, total_ttc,
                                localisation, description, nouv_prix,
                                designation_article, lotDesignation
                            ];
                        } else {
                            insertQuery = `
                                INSERT INTO projet_article (
                                    structure, article, 
                                    quantite, prix_total_ht, tva, total_ttc,
                                    localisation, description, nouv_prix,
                                    designation_article, designation_lot
                                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                                RETURNING *
                            `;
                            params = [
                                structureIdFromData, article,
                                quantite, prix_total_ht, tva, total_ttc,
                                localisation, description, nouv_prix,
                                designation_article, lotDesignation
                            ];
                        }
                    } else {
                        if (hasProjetCol) {
                            insertQuery = `
                                INSERT INTO projet_article (
                                    projet, structure, article, 
                                    quantite, prix_total_ht, tva, total_ttc,
                                    localisation, description, nouv_prix,
                                    designation_article
                                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                                RETURNING *
                            `;
                            params = [
                                projet, structureIdFromData, article,
                                quantite, prix_total_ht, tva, total_ttc,
                                localisation, description, nouv_prix,
                                designation_article
                            ];
                        } else {
                            insertQuery = `
                                INSERT INTO projet_article (
                                    structure, article, 
                                    quantite, prix_total_ht, tva, total_ttc,
                                    localisation, description, nouv_prix,
                                    designation_article
                                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                                RETURNING *
                            `;
                            params = [
                                structureIdFromData, article,
                                quantite, prix_total_ht, tva, total_ttc,
                                localisation, description, nouv_prix,
                                designation_article
                            ];
                        }
                    }
                } else {
                    // Build query dynamically based on which columns exist
                    const columns = [];
                    const values = [];
                    const valuePlaceholders = [];
                    let paramIndex = 1;

                    // Always include these columns if they exist
                    if (hasProjetCol) {
                        columns.push('projet');
                        values.push(projet);
                        valuePlaceholders.push(`$${paramIndex++}`);
                    }
                    if (hasLotCol) {
                        columns.push('lot');
                        values.push(finalLotId);
                        valuePlaceholders.push(`$${paramIndex++}`);
                    }
                    columns.push('ouvrage', 'bloc', 'article');
                    values.push(gblocId, blocId, article);
                    valuePlaceholders.push(`$${paramIndex++}`, `$${paramIndex++}`, `$${paramIndex++}`);

                    // Always include these columns
                    columns.push('quantite', 'prix_total_ht', 'tva', 'total_ttc', 'localisation', 'description', 'nouv_prix', 'designation_article');
                    values.push(quantite, prix_total_ht, tva, total_ttc, localisation, description, nouv_prix, designation_article);
                    valuePlaceholders.push(`$${paramIndex++}`, `$${paramIndex++}`, `$${paramIndex++}`, `$${paramIndex++}`, `$${paramIndex++}`, `$${paramIndex++}`, `$${paramIndex++}`, `$${paramIndex++}`);

                    if (hasDesignationLot) {
                        columns.push('designation_lot');
                        values.push(lotDesignation);
                        valuePlaceholders.push(`$${paramIndex++}`);
                    }

                    insertQuery = `
                        INSERT INTO projet_article (
                            ${columns.join(', ')}
                        ) VALUES (${valuePlaceholders.join(', ')})
                        RETURNING *
                    `;
                    params = values;
                }
            } else {
                const maxId = await dbClient.query('SELECT COALESCE(MAX(id), 0) as max_id FROM projet_article');
                const nextId = maxId.rows[0].max_id + 1;

                if (hasStructureId) {
                    if (hasDesignationLot) {
                        if (hasProjetCol) {
                            insertQuery = `
                                INSERT INTO projet_article (
                                    id, projet, structure, article, 
                                    quantite, prix_total_ht, tva, total_ttc,
                                    localisation, description, nouv_prix,
                                    designation_article, designation_lot
                                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                                RETURNING *
                            `;
                            params = [
                                nextId, projet, structureIdFromData, article,
                                quantite, prix_total_ht, tva, total_ttc,
                                localisation, description, nouv_prix,
                                designation_article, lotDesignation
                            ];
                        } else {
                            insertQuery = `
                                INSERT INTO projet_article (
                                    id, structure, article, 
                                    quantite, prix_total_ht, tva, total_ttc,
                                    localisation, description, nouv_prix,
                                    designation_article, designation_lot
                                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                                RETURNING *
                            `;
                            params = [
                                nextId, structureIdFromData, article,
                                quantite, prix_total_ht, tva, total_ttc,
                                localisation, description, nouv_prix,
                                designation_article, lotDesignation
                            ];
                        }
                    } else {
                        if (hasProjetCol) {
                            insertQuery = `
                                INSERT INTO projet_article (
                                    id, projet, structure, article, 
                                    quantite, prix_total_ht, tva, total_ttc,
                                    localisation, description, nouv_prix,
                                    designation_article
                                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                                RETURNING *
                            `;
                            params = [
                                nextId, projet, structureIdFromData, article,
                                quantite, prix_total_ht, tva, total_ttc,
                                localisation, description, nouv_prix,
                                designation_article
                            ];
                        } else {
                            insertQuery = `
                                INSERT INTO projet_article (
                                    id, structure, article, 
                                    quantite, prix_total_ht, tva, total_ttc,
                                    localisation, description, nouv_prix,
                                    designation_article
                                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                                RETURNING *
                            `;
                            params = [
                                nextId, structureIdFromData, article,
                                quantite, prix_total_ht, tva, total_ttc,
                                localisation, description, nouv_prix,
                                designation_article
                            ];
                        }
                    }
                } else {
                    if (hasDesignationLot) {
                        insertQuery = `
                            INSERT INTO projet_article (
                                id, projet, lot, ouvrage, bloc, article, 
                                quantite, prix_total_ht, tva, total_ttc,
                                localisation, description, nouv_prix,
                                designation_article, designation_lot
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                            RETURNING *
                        `;
                        params = [
                            nextId, projet, finalLotId, gblocId, blocId, article,
                            quantite, prix_total_ht, tva, total_ttc,
                            localisation, description, nouv_prix,
                            designation_article, lotDesignation
                        ];
                    } else {
                        insertQuery = `
                            INSERT INTO projet_article (
                                id, projet, lot, ouvrage, bloc, article, 
                                quantite, prix_total_ht, tva, total_ttc,
                                localisation, description, nouv_prix,
                                designation_article
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                            RETURNING *
                        `;
                        params = [
                            nextId, projet, finalLotId, gblocId, blocId, article,
                            quantite, prix_total_ht, tva, total_ttc,
                            localisation, description, nouv_prix,
                            designation_article
                        ];
                    }
                }
            }

            const result = await dbClient.query(insertQuery, params);

            if (useTransaction) await dbClient.query('COMMIT');
            const created = result.rows[0];
            // Add g_bloc alias for backward compatibility
            if (created && created.ouvrage !== undefined) {
                created.g_bloc = created.ouvrage;
            }
            return created;
        } catch (error) {
            if (useTransaction) await dbClient.query('ROLLBACK');
            throw error;
        } finally {
            if (useTransaction) dbClient.release();
        }
    }

    /**
     * Update a projet_article entry
     */
    static async update(id, updateData, client = null) {
        const dbClient = client || await pool.connect();
        const useTransaction = !client;

        try {
            if (useTransaction) await dbClient.query('BEGIN');

            // Get current record for validation
            const current = await this.findById(id, dbClient);
            if (!current) {
                throw new Error('Project article not found');
            }

            // Validate hierarchy if updating hierarchy fields (no niv_1 anymore)
            const hierarchyData = {
                lot: updateData.lot ?? current.lot,
                ouvrage: updateData.ouvrage ?? updateData.g_bloc ?? updateData.gbloc ?? current.ouvrage ?? current.g_bloc ?? current.gbloc,
                bloc: updateData.bloc ?? current.bloc,
                article: updateData.article ?? current.article
            };
            this.validateHierarchy(hierarchyData);

            if (Object.prototype.hasOwnProperty.call(updateData, 'lot')) {
                updateData.lot = await ensureLotId(dbClient, updateData.lot);
            }

            // Build update query
            const updateFields = [];
            const params = [];
            let paramIndex = 1;

            const allowedFields = [
                'lot', 'ouvrage', 'bloc', 'article',
                'Niveau_5__article', 'Niveau_6__detail_article',
                'unite', 'quantite', 'pu', 'prix_total_ht', 'tva', 'total_ttc',
                'localisation', 'description', 'nouv_prix',
                'designation_article'
            ];

            for (const field of allowedFields) {
                if (updateData[field] !== undefined) {
                    updateFields.push(`${field} = $${paramIndex}`);
                    params.push(updateData[field]);
                    paramIndex++;
                }
            }

            if (updateFields.length === 0) {
                throw new Error('No valid fields to update');
            }

            const updateQuery = `
                UPDATE projet_article 
                SET ${updateFields.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING *
            `;
            params.push(id);

            const result = await dbClient.query(updateQuery, params);

            // Recalculate project's selling price (prix_vente) after updating article
            // Only if price-related fields were updated
            const priceFields = ['quantite', 'prix_total_ht', 'tva', 'total_ttc', 'nouv_prix', 'pu'];
            const hasPriceUpdate = priceFields.some(field => updateData[field] !== undefined);
            if (hasPriceUpdate) {
                const Project = require('./Project');
                try {
                    await Project.recalculatePrixVente(current.projet, dbClient);
                } catch (recalcError) {
                    console.error('Failed to recalculate prix_vente after updating article:', recalcError);
                    // Don't throw - the article was updated successfully
                }
            }

            if (useTransaction) await dbClient.query('COMMIT');
            const updated = result.rows[0];
            // Add g_bloc alias for backward compatibility
            if (updated && updated.ouvrage !== undefined) {
                updated.g_bloc = updated.ouvrage;
            }
            return updated;
        } catch (error) {
            if (useTransaction) await dbClient.query('ROLLBACK');
            throw error;
        } finally {
            if (useTransaction) dbClient.release();
        }
    }

    /**
     * Delete a projet_article entry
     */
    static async delete(id, client = null) {
        const dbClient = client || await pool.connect();
        const useTransaction = !client;

        try {
            if (useTransaction) await dbClient.query('BEGIN');

            // Get project ID before deletion for recalculation
            const projectCheck = await dbClient.query(
                'SELECT projet FROM projet_article WHERE id = $1',
                [id]
            );
            const projectId = projectCheck.rows[0]?.projet || null;

            const result = await dbClient.query(
                'DELETE FROM projet_article WHERE id = $1 RETURNING *',
                [id]
            );

            // Recalculate project's selling price (prix_vente) after deletion (inside transaction)
            // This ensures prix_vente is updated based on ALL remaining projet_article rows
            if (result.rows.length > 0 && projectId) {
                try {
                    const Project = require('./Project');
                    await Project.recalculatePrixVente(projectId, dbClient);
                    console.log(`✅ Recalculated prix_vente after deleting projet_article (id: ${id}, projectId: ${projectId})`);
                } catch (recalcError) {
                    console.error('❌ Failed to recalculate prix_vente after deleting projet_article:', recalcError);
                    // Don't throw - the article was deleted successfully
                }
            }

            if (useTransaction) await dbClient.query('COMMIT');
            const deleted = result.rows[0];
            // Add g_bloc alias for backward compatibility
            if (deleted && deleted.ouvrage !== undefined) {
                deleted.g_bloc = deleted.ouvrage;
            }
            return deleted;
        } catch (error) {
            if (useTransaction) await dbClient.query('ROLLBACK');
            throw error;
        } finally {
            if (useTransaction) dbClient.release();
        }
    }

    /**
     * Find projet_article by ID
     */
    static async findById(id, client = null) {
        const dbClient = client || await pool.connect();
        try {
            // Use buildNormalizedArticlesSubquery to get properly formatted subquery with alias
            const normalizedSubquery = NiveauService.buildNormalizedArticlesSubquery('a');
            const query = `
                SELECT pa.*, 
                       s.ouvrage as g_bloc,
                       a."ID" as catalogue_id,
                       niv1.niveau_1 as niveau1_article,
                       niv2.niveau_2 as niveau2_article,
                       niv3.niveau_3 as niveau3_article,
                       niv4.niveau_4 as niveau4_article,
                       niv5.niveau_5 as niveau5_article,
                       niv6.niveau_6 as niveau6_article,
                       a."nom_article" as article_name,
                       b.nom_bloc,
                       o.nom_ouvrage as nom_gbloc
                FROM projet_article pa
                LEFT JOIN ${normalizedSubquery} ON a."ID" = pa.article
                ${ARTICLE_HIERARCHY_JOIN}
                LEFT JOIN structure s ON s.id_structure = pa.structure
                LEFT JOIN bloc b ON b.id = s.bloc
                LEFT JOIN ouvrage o ON o.id = s.ouvrage
                WHERE pa.id = $1
            `;
            const result = await dbClient.query(query, [id]);
            return result.rows[0] || null;
        } finally {
            if (!client) dbClient.release();
        }
    }

    /**
     * Get articles by hierarchy level
     */
    static async findByHierarchy(projectId, hierarchyKey, options = {}) {
        const { lot, gbloc, bloc } = hierarchyKey;
        const { includeDetails = true, page = 1, limit = 100 } = options;

        const dbClient = await pool.connect();
        try {
            const offset = (page - 1) * limit;

            let whereClause = 'INNER JOIN structure s ON s.id_structure = pa.structure INNER JOIN ouvrage o ON o.id = s.ouvrage INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot WHERE pl.id_projet = $1';
            let params = [projectId];
            let paramIndex = 2;

            if (lot) {
                whereClause += ` AND pl.id_lot = $${paramIndex}`;
                params.push(lot);
                paramIndex++;
            }

            if (gbloc) {
                whereClause += ` AND s.ouvrage = $${paramIndex}`;
                params.push(gbloc);
                paramIndex++;
            }

            if (bloc) {
                whereClause += ` AND s.bloc = $${paramIndex}`;
                params.push(bloc);
                paramIndex++;
            }

            let selectFields = [
                'pa.id',
                'pl.id_lot as lot',
                's.ouvrage as gbloc',
                's.bloc AS bloc_id', // ✅ FIX: Return as bloc_id to match frontend filtering
                'pa.article',
                'COALESCE(pa.designation_article, art."nom_article") as article_name',
                'pa.designation_article as detail_article',
                'art."Unite" as unite',
                'pa.quantite',
                'pa.pu',
                'pa.prix_total_ht',
                'pa.tva',
                'pa.total_ttc',
                'pa.localisation',
                'pa.description',
                'pa.nouv_prix'
            ];

            if (includeDetails) {
                selectFields.push(
                    'art."ID" as catalogue_id',
                    'b.nom_bloc',
                    'o.nom_ouvrage as nom_gbloc'
                );
            }

            const query = `
                SELECT ${selectFields.join(', ')}
                FROM projet_article pa
                LEFT JOIN articles art ON art."ID" = pa.article
                LEFT JOIN structure s ON s.id_structure = pa.structure
                LEFT JOIN bloc b ON b.id = s.bloc
                LEFT JOIN ouvrage o ON o.id = s.ouvrage
                LEFT JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                ${whereClause}
                ORDER BY pa.id
                LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
            `;

            params.push(limit, offset);
            const result = await dbClient.query(query, params);

            // Get total count for pagination
            const countQuery = `
                SELECT COUNT(*) as total
                FROM projet_article pa
                LEFT JOIN structure s ON s.id_structure = pa.structure
                LEFT JOIN ouvrage o ON o.id = s.ouvrage
                LEFT JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                ${whereClause}
            `;
            const countResult = await dbClient.query(countQuery, params.slice(0, -2));

            return {
                articles: result.rows,
                pagination: {
                    page,
                    limit,
                    total: parseInt(countResult.rows[0].total),
                    totalPages: Math.ceil(countResult.rows[0].total / limit)
                }
            };
        } finally {
            dbClient.release();
        }
    }

    /**
     * Get aggregated totals for a hierarchy level
     */
    static async getHierarchyTotals(projectId, hierarchyKey) {
        const { lot, gbloc, bloc } = hierarchyKey;

        const dbClient = await pool.connect();
        try {
            // Check if lot column exists
            const lotColCheck = await dbClient.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'projet_article' AND column_name = 'lot'
            `);
            const hasLotCol = lotColCheck.rows.length > 0;

            let whereClause = 'WHERE projet = $1';
            let params = [projectId];
            let paramIndex = 2;

            if (lot && hasLotCol) {
                whereClause += ` AND lot = $${paramIndex}`;
                params.push(lot);
                paramIndex++;
            }

            if (gbloc) {
                whereClause += ` AND ouvrage = $${paramIndex}`;
                params.push(gbloc);
                paramIndex++;
            }

            if (bloc) {
                whereClause += ` AND bloc = $${paramIndex}`;
                params.push(bloc);
                paramIndex++;
            }

            const query = `
            SELECT 
                COUNT(CASE WHEN article IS NOT NULL THEN 1 END) as article_count,
                COUNT(DISTINCT bloc) as bloc_count,
                COUNT(DISTINCT ouvrage) as gbloc_count,
                ${hasLotCol ? 'COUNT(DISTINCT lot) as lot_count,' : ''}
                COALESCE(SUM(total_ttc), 0)::float as total_ttc,
                COALESCE(SUM(prix_total_ht), 0)::float as total_ht,
                COALESCE(AVG(pu), 0)::float as avg_pu,
                COALESCE(SUM(quantite), 0)::float as total_quantity
            FROM projet_article 
            ${whereClause}
        `;

            const result = await dbClient.query(query, params);
            return result.rows[0];
        } finally {
            dbClient.release();
        }
    }

    /**
     * Search articles in catalogue for adding to hierarchy
     */
    static async searchCatalogue(searchParams, options = {}) {
        const {
            searchText,
            niveau2,
            niveau3,
            niveau4,
            page = 1,
            limit = 50
        } = searchParams;

        const dbClient = await pool.connect();
        try {
            const offset = (page - 1) * limit;

            let whereClause = 'WHERE 1=1';
            let params = [];
            let paramIndex = 1;

            if (searchText) {
                whereClause += ` AND (
                    a."Niveau_5__article" ILIKE $${paramIndex} OR 
                    a."Niveau_6__detail_article" ILIKE $${paramIndex} OR
                    a."Niveau_3" ILIKE $${paramIndex} OR
                    a."Niveau_4" ILIKE $${paramIndex}
                )`;
                params.push(`%${searchText}%`);
                paramIndex++;
            }

            if (niveau2) {
                whereClause += ` AND a."Niveau_2__lot" = $${paramIndex}`;
                params.push(niveau2);
                paramIndex++;
            }

            if (niveau3) {
                whereClause += ` AND a."Niveau_3" = $${paramIndex}`;
                params.push(niveau3);
                paramIndex++;
            }

            if (niveau4) {
                whereClause += ` AND a."Niveau_4" = $${paramIndex}`;
                params.push(niveau4);
                paramIndex++;
            }

            const query = `
                SELECT 
                    a."ID" as id,
                    a."Niveau_1" as niv_1,
                    a."Niveau_2__lot" as niveau2,
                    a."Niveau_3" as niveau3,
                    a."Niveau_4" as niveau4,
                    a."Niveau_5__article" as article_name,
                    a."Niveau_6__detail_article" as detail_article,
                    a."Niveau_3" as niveau3_category,
                    a."Niveau_4" as niveau4_category,
                    a."Unite" as unite,
                    a."PU" as pu,
                    a."Date" as date_article
                FROM ${NORMALIZED_ARTICLES_SUBQUERY} a
                ${whereClause}
                ORDER BY a."Niveau_5__article"
                LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
            `;

            params.push(limit, offset);
            const result = await dbClient.query(query, params);

            // Get total count for pagination
            const countQuery = `
                SELECT COUNT(*) as total
                FROM ${NORMALIZED_ARTICLES_SUBQUERY} a
                ${whereClause}
            `;
            const countResult = await dbClient.query(countQuery, params.slice(0, -2));

            return {
                articles: result.rows,
                pagination: {
                    page,
                    limit,
                    total: parseInt(countResult.rows[0].total),
                    totalPages: Math.ceil(countResult.rows[0].total / limit)
                }
            };
        } finally {
            dbClient.release();
        }
    }

    /**
     * Validate hierarchy according to allowed combinations
     * Note: niv_1 column has been removed from the database
     */
    static validateHierarchy({ lot, gbloc, ouvrage, bloc, article }) {
        // Check for invalid combinations (gaps in hierarchy)
        // Hierarchy: Lot → Ouvrage → (Bloc) → Article
        // Lot is optional (just a filter/sheet dimension)
        // Bloc is optional - articles can be added directly to Ouvrage
        const ouvrageId = ouvrage ?? gbloc;
        if (article && !ouvrageId) {
            throw new Error('ouvrage is required when article is specified');
        }
        if (bloc && !ouvrageId) {
            throw new Error('ouvrage is required when bloc is specified');
        }
        // Note: lot is NOT required when ouvrage is specified - it's just a filter dimension
        // Note: bloc is NOT required when article is specified - articles can be added directly to ouvrage

        // All combinations are valid as long as there are no gaps
        return true;
    }

    /**
     * Add catalogue article to project hierarchy
     */
    static async addCatalogueArticle(projectId, hierarchyKey, catalogueId, quantity = 1, options = {}) {
        const dbClient = await pool.connect();
        try {
            await dbClient.query('BEGIN');

            // Get catalogue article details
            const catalogueResult = await dbClient.query(
                `SELECT * FROM ${NORMALIZED_ARTICLES_SUBQUERY} WHERE "ID" = $1`,
                [catalogueId]
            );

            if (catalogueResult.rows.length === 0) {
                throw new Error('Catalogue article not found');
            }

            const catalogue = catalogueResult.rows[0];

            // Calculate totals
            const pu = catalogue["PU"] || 0;
            const tva = options.tva || 0;
            const prixTotalHt = pu * quantity;
            const totalTtc = prixTotalHt * (1 + tva / 100);

            // Calculate article designation
            const DesignationHelper = require('../utils/designationHelper');
            const ouvrageId = hierarchyKey.ouvrage ?? hierarchyKey.g_bloc ?? hierarchyKey.gbloc;
            const blocId = hierarchyKey.bloc;

            let articleDesignation = null;

            if (blocId) {
                let blocDesignationValue = null;

                // First, try to get bloc designation from database
                const blocCheck = await dbClient.query('SELECT designation FROM bloc WHERE id = $1', [blocId]);
                if (blocCheck.rows.length > 0 && blocCheck.rows[0].designation && String(blocCheck.rows[0].designation).trim() !== '') {
                    blocDesignationValue = String(blocCheck.rows[0].designation).trim();
                }

                // Calculate article designation directly using bloc designation if present,
                // otherwise fall back to helper that works without bloc designation
                if (blocDesignationValue && blocDesignationValue.trim() !== '') {
                    // Count articles in this bloc
                    const articlesResult = await dbClient.query(
                        `SELECT COUNT(*) as count 
                         FROM projet_article pa 
                         INNER JOIN structure s ON s.id_structure = pa.structure
                         INNER JOIN ouvrage o ON o.id = s.ouvrage
                         INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                         WHERE pl.id_projet = $1 AND s.bloc = $2 AND pa.article IS NOT NULL`,
                        [projectId, blocId]
                    );
                    const articleIndex = parseInt(articlesResult.rows[0].count || 0) + 1;
                    articleDesignation = `${blocDesignationValue}.${articleIndex}`;
                } else {
                    // Fallback: try to get from helper function
                    articleDesignation = await DesignationHelper.getNextArticleDesignation(dbClient, projectId, ouvrageId, blocId);
                }
            } else if (ouvrageId) {
                // No blocId - article directly in ouvrage
                // Ensure ouvrage designation is set before calculating article designation
                let ouvrageDesignation = null;

                // First, try to get ouvrage designation from database
                const ouvrageCheck = await dbClient.query('SELECT designation FROM ouvrage WHERE id = $1', [ouvrageId]);
                if (ouvrageCheck.rows.length > 0 && ouvrageCheck.rows[0].designation && String(ouvrageCheck.rows[0].designation).trim() !== '') {
                    ouvrageDesignation = String(ouvrageCheck.rows[0].designation).trim();
                }

                // If ouvrage doesn't have designation, calculate and set it
                if (!ouvrageDesignation) {
                    // Pass the dbClient so it can see uncommitted data
                    ouvrageDesignation = await DesignationHelper.getNextOuvrageDesignation(dbClient, projectId);
                    if (ouvrageDesignation) {
                        await dbClient.query('UPDATE ouvrage SET designation = $1 WHERE id = $2', [ouvrageDesignation, ouvrageId]);
                    }
                }

                // Verify ouvrage designation is now set (re-query to be absolutely sure)
                const ouvrageVerify = await dbClient.query('SELECT designation FROM ouvrage WHERE id = $1', [ouvrageId]);
                if (ouvrageVerify.rows.length > 0 && ouvrageVerify.rows[0].designation && String(ouvrageVerify.rows[0].designation).trim() !== '') {
                    ouvrageDesignation = String(ouvrageVerify.rows[0].designation).trim();
                }

                // Calculate article designation directly using ouvrage designation
                if (ouvrageDesignation && ouvrageDesignation.trim() !== '') {
                    // Count articles directly in ouvrage (excluding the one we're about to add)
                    const articlesResult = await dbClient.query(
                        `SELECT COUNT(*) as count 
                         FROM projet_article pa 
                         INNER JOIN structure s ON s.id_structure = pa.structure
                         INNER JOIN ouvrage o ON o.id = s.ouvrage
                         INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                         WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND s.bloc IS NULL AND pa.article IS NOT NULL`,
                        [projectId, ouvrageId]
                    );
                    const articleIndex = parseInt(articlesResult.rows[0].count || 0) + 1;
                    // Format: ouvrageDesignation.articleIndex (e.g., "5.6.1" for ouvrage "5.6")
                    articleDesignation = `${ouvrageDesignation}.${articleIndex}`;
                } else {
                    // Fallback to helper function if designation still not set
                    articleDesignation = await DesignationHelper.getNextArticleDesignation(dbClient, projectId, ouvrageId, null);
                }
            } else {
                // No bloc and no ouvrage - shouldn't happen, but use default
                articleDesignation = await DesignationHelper.getNextArticleDesignation(dbClient, projectId, null, null);
            }

            // Ensure we have a designation (should never be null at this point, but safety check)
            if (!articleDesignation || articleDesignation.trim() === '') {
                articleDesignation = '1.1.1'; // Last resort default
            }

            // Create projet_article entry (no niv_1 anymore)
            const articleData = {
                projet: projectId,
                lot: hierarchyKey.lot || catalogue["Niveau_2__lot"],
                ouvrage: ouvrageId,
                bloc: blocId,
                article: catalogueId,
                niveau_5_article: catalogue["Niveau_5__article"],
                niveau_6_detail_article: catalogue["Niveau_6__detail_article"],
                unite: catalogue["Unite"],
                quantite: quantity,
                pu: pu,
                prix_total_ht: prixTotalHt,
                tva: tva,
                total_ttc: totalTtc,
                localisation: options.localisation,
                description: options.description,
                nouv_prix: options.nouv_prix,
                designation_article: articleDesignation
            };

            const result = await this.create(articleData, dbClient);

            // If article was added directly to ouvrage (blocId is null), recalculate bloc designations
            // This ensures blocs are numbered after articles in ouvrage
            if (!blocId && ouvrageId) {
                try {
                    // Get ouvrage designation to use as base for recalculation
                    const ouvrageResult = await dbClient.query('SELECT designation FROM ouvrage WHERE id = $1', [ouvrageId]);
                    const ouvrageDesignation = ouvrageResult.rows[0]?.designation || null;

                    if (ouvrageDesignation) {
                        // Get lot ID if lot name is provided
                        // Lots are stored in niveau_2 table, not a separate lot table
                        let lotId = null;
                        if (hierarchyKey.lot) {
                            // ensureLotId is already imported at the top of the file
                            lotId = await ensureLotId(dbClient, hierarchyKey.lot, { allowInsert: false });
                        }

                        // Recalculate designations for this ouvrage only
                        // This will update bloc designations to account for articles in ouvrage
                        await DesignationHelper.recalculateProjectDesignations(
                            projectId,
                            dbClient,
                            ouvrageDesignation,
                            ouvrageId,
                            lotId
                        );
                    }
                } catch (recalcError) {
                    console.error('Failed to recalculate bloc designations after adding article to ouvrage:', recalcError);
                    // Don't throw - the article was added successfully
                }
            }

            // Recalculate project's selling price (prix_vente) after adding article (inside transaction)
            const Project = require('./Project');
            try {
                await Project.recalculatePrixVente(projectId, dbClient);
                console.log(`✅ Recalculated prix_vente after adding catalogue article (catalogueId: ${catalogueId}, blocId: ${blocId || 'none'}, ouvrageId: ${ouvrageId || 'none'})`);
            } catch (recalcError) {
                console.error('❌ Failed to recalculate prix_vente after adding catalogue article:', recalcError);
                // Don't throw - the article was added successfully
            }

            await dbClient.query('COMMIT');
            return result;
        } catch (error) {
            await dbClient.query('ROLLBACK');
            throw error;
        } finally {
            dbClient.release();
        }
    }
}

module.exports = ProjectArticle;
