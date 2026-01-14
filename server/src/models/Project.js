const pool = require('../../config/db');
const EventNotificationService = require('../services/EventNotificationService');
const { buildNormalizedArticlesSubquery } = require('../services/NiveauService');
const Gbloc = require('./Gbloc');
const { ensureLotId } = require('../utils/lotHelper');
const Structure = require('./Structure');

class Project {
    /**
     * Get all projects with pagination and search
     */
    static async findAll({ search = '', page = 1, limit = 10, userId = null, isAdmin = false }) {
        const offset = (page - 1) * limit;

        const params = [];
        const conditions = [];

        // Build WHERE conditions
        if (!isAdmin && userId) {
            conditions.push(`EXISTS (SELECT 1 FROM projet_equipe pe WHERE pe.projet = p.id AND pe.equipe = $${params.length + 1})`);
            params.push(userId);
        }

        // Search filter
        if (search) {
            const searchParamIndex = params.length + 1;
            conditions.push(`p."Nom_Projet" ILIKE $${searchParamIndex}`);
            params.push(`%${search}%`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const query = `
            SELECT 
                p.id,
                p."Nom_Projet" as nom_projet,
                p."Date_Limite" as date_limite,
                p."Date_Debut" as date_debut,
                p.etat,
                p."Ajouté_par" as ajoute_par,
                u.nom_utilisateur as ajoute_par_nom,
                u.email as ajoute_par_email,
                COALESCE(team.team_count, 0)::int AS team_count,
                COALESCE(arts.article_count, 0)::int AS article_count,
                cl.nom_client as client_nom,
                cl.marge_brut as client_marge_brut,
                cl.marge_net as client_marge_net
            FROM projets p
            LEFT JOIN users u ON u.id = p."Ajouté_par"
            LEFT JOIN client cl ON cl.id = p.client
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS team_count FROM projet_equipe pe WHERE pe.projet = p.id
            ) team ON true
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS article_count 
                FROM projet_article pa 
                INNER JOIN structure s ON s.id_structure = pa.structure
                INNER JOIN ouvrage o ON o.id = s.ouvrage
                INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                WHERE pl.id_projet = p.id
            ) arts ON true
            ${whereClause}
            ORDER BY p.id DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;

        params.push(limit, offset);

        if (typeof pool.connect === 'function') {
            const client = await pool.connect();
            try {
                const result = await client.query(query, params);
                return result.rows;
            } finally {
                client.release();
            }
        } else {
            const result = await pool.query(query, params);
            return result.rows;
        }
    }

    /**
     * Get project by ID with full details
     */
    static async findById(projectId) {
        const query = `
            SELECT 
                p.*,
                u.nom_utilisateur as ajoute_par_nom,
                u.email as ajoute_par_email,
                cl.nom_client as client_nom,
                cl.marge_brut as client_marge_brut,
                cl.marge_net as client_marge_net
            FROM projets p
            LEFT JOIN users u ON p."Ajouté_par" = u.id
            LEFT JOIN client cl ON cl.id = p.client
            WHERE p.id = $1
        `;
        if (typeof pool.connect === 'function') {
            const client = await pool.connect();
            try {
                const result = await client.query(query, [projectId]);
                return result.rows[0] || null;
            } finally {
                client.release();
            }
        } else {
            const result = await pool.query(query, [projectId]);
            return result.rows[0] || null;
        }
    }

    /**
     * Recalculate and persist project's selling price (prix_vente)
     */
    static async recalculatePrixVente(projectId, client = null) {
        const db = client || await pool.connect();
        try {
            // 1. Get project margin coefficient FIRST
            let coef = 1;
            try {
                const { rows: m } = await db.query(
                    `SELECT cl.marge_brut::float AS mb, cl.marge_net::float AS mn
                     FROM projets p LEFT JOIN client cl ON cl.id = p.client
                     WHERE p.id = $1`,
                    [projectId]
                );
                const mb = Number(m[0]?.mb || 0);
                const mn = Number(m[0]?.mn || 0);
                const denom = 1 - (mb / 100) - (mn / 100);
                coef = (isFinite(denom) && denom > 0) ? (1 / denom) : 1;
            } catch { }

            // 2. Update `projet_lot` totals based on their `ouvrage` children
            // This ensures `projet_lot` table always reflects the sum of its ouvrages
            const updateResult = await db.query(`
                UPDATE projet_lot pl
                SET 
                    prix_total = (
                        SELECT COALESCE(SUM(o.prix_total), 0)
                        FROM ouvrage o 
                        WHERE o.projet_lot = pl.id_projet_lot
                    ),
                    prix_vente = (
                        SELECT COALESCE(SUM(o.prix_total), 0) * $2
                        FROM ouvrage o 
                        WHERE o.projet_lot = pl.id_projet_lot
                    )
                WHERE pl.id_projet = $1
                RETURNING id_projet_lot, prix_total, prix_vente
            `, [projectId, coef]);

            console.log(`[RECALC PRIX_VENTE] Updated ${updateResult.rowCount} projet_lot rows:`,
                updateResult.rows.map(r => `Lot ${r.id_projet_lot}: ${r.prix_total}€ / ${r.prix_vente}€`).join(', '));

            // 3. Calculate project totals by summing `projet_lot` values
            // This aligns with the requirement: "somme prix_total is the cout and somme prix_vente from projet_lot"
            const { rows: sumR } = await db.query(
                `SELECT 
                    COALESCE(SUM(pl.prix_total), 0)::float AS sum_ttc, 
                    COALESCE(SUM(pl.prix_vente), 0)::float AS sum_vente,
                    COUNT(*)::int AS row_count 
                 FROM projet_lot pl
                 WHERE pl.id_projet = $1`,
                [projectId]
            );

            const sumTtc = sumR[0]?.sum_ttc || 0;
            const prixVente = sumR[0]?.sum_vente || 0;
            const rowCount = sumR[0]?.row_count || 0;

            await db.query('UPDATE projets SET prix_vente = $1, "Cout" = $2 WHERE id = $3', [prixVente, sumTtc, projectId]);
            console.log(`[RECALC PRIX_VENTE] Project ${projectId}: sumTtc=${sumTtc}, rowCount=${rowCount}, coef=${coef}, prixVente=${prixVente}`);

            // Clear cache for this project to ensure frontend gets updated prix_vente
            try {
                const { cache } = require('../utils/cache');
                const cacheKey = ['projects:item', projectId];
                cache.del(cacheKey);
                console.log(`[RECALC PRIX_VENTE] Cleared cache for project ${projectId}`);
            } catch (cacheError) {
                // Cache might not be available, that's okay
                console.warn('Could not clear cache after prix_vente recalculation:', cacheError);
            }

            return prixVente;
        } finally {
            if (!client) db.release();
        }
    }

    /**
     * Create a new project
     */
    static async create(projectData, client = null) {
        const dbClient = client || await pool.connect();
        const useTransaction = !client;

        try {
            if (useTransaction) await dbClient.query('BEGIN');

            const {
                nom_projet,
                date_limite,
                date_debut,
                description,
                file,
                adresse,
                cout,
                etat,
                userId,
                clientId
            } = projectData;

            // Check if id column has default value
            const idCheckResult = await dbClient.query(
                `SELECT column_default FROM information_schema.columns 
                 WHERE table_name='projets' AND column_name='id'`
            );

            let insertProjectSql;
            let params;

            const hasClientCol = await dbClient.query(
                `SELECT 1 FROM information_schema.columns 
                 WHERE table_name='projets' AND column_name='client'`
            );

            if (idCheckResult.rows[0]?.column_default) {
                // id has a default value
                if (hasClientCol.rows.length > 0 && clientId !== null) {
                    insertProjectSql = `
                        INSERT INTO projets (
                            "Nom_Projet", "Date_Limite", "Ajouté_par", "Description", file,
                            adresse, "Cout", "Date_Debut", etat, client, created_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                        RETURNING id
                    `;
                    params = [
                        nom_projet,
                        date_limite || null,
                        userId,
                        description || null,
                        file || null,
                        adresse || null,
                        cout || null,
                        date_debut || null,
                        etat || null,
                        clientId,
                    ];
                } else {
                    insertProjectSql = `
                        INSERT INTO projets (
                            "Nom_Projet", "Date_Limite", "Ajouté_par", "Description", file,
                            adresse, "Cout", "Date_Debut", etat, created_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                        RETURNING id
                    `;
                    params = [
                        nom_projet,
                        date_limite || null,
                        userId,
                        description || null,
                        file || null,
                        adresse || null,
                        cout || null,
                        date_debut || null,
                        etat || null,
                    ];
                }
            } else {
                // Generate id manually
                const maxIdResult = await dbClient.query('SELECT COALESCE(MAX(id), 0) as max_id FROM projets');
                const nextId = maxIdResult.rows[0].max_id + 1;

                if (hasClientCol.rows.length > 0 && clientId !== null) {
                    insertProjectSql = `
                        INSERT INTO projets (
                            id, "Nom_Projet", "Date_Limite", "Ajouté_par", "Description", file,
                            adresse, "Cout", "Date_Debut", etat, client, created_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
                        RETURNING id
                    `;
                    params = [
                        nextId,
                        nom_projet,
                        date_limite || null,
                        userId,
                        description || null,
                        file || null,
                        adresse || null,
                        cout || null,
                        date_debut || null,
                        etat || null,
                        clientId,
                    ];
                } else {
                    insertProjectSql = `
                        INSERT INTO projets (
                            id, "Nom_Projet", "Date_Limite", "Ajouté_par", "Description", file,
                            adresse, "Cout", "Date_Debut", etat, created_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                        RETURNING id
                    `;
                    params = [
                        nextId,
                        nom_projet,
                        date_limite || null,
                        userId,
                        description || null,
                        file || null,
                        adresse || null,
                        cout || null,
                        date_debut || null,
                        etat || null,
                    ];
                }
            }

            const { rows } = await dbClient.query(insertProjectSql, params);
            const projectId = rows[0].id;

            // Create event and notifications only when Project.create
            // manages its own transaction (no external client)
            if (!client) {
                try {
                    await EventNotificationService.projectCreated(projectId, userId, projectData);
                } catch (eventError) {
                    console.error('Failed to create project event:', eventError);
                    // Don't fail the project creation if event creation fails
                }
            }

            if (useTransaction) await dbClient.query('COMMIT');
            return projectId;
        } catch (error) {
            if (useTransaction) await dbClient.query('ROLLBACK');
            throw error;
        } finally {
            if (useTransaction) dbClient.release();
        }
    }

    /**
     * Update project
     */
    static async update(projectId, projectData, userId = null, isUserAction = false, client = null, options = {}) {
        const dbClient = client || await pool.connect();
        const useTransaction = !client;

        try {
            if (useTransaction) await dbClient.query('BEGIN');

            // Get current project data to track changes
            const currentProject = await dbClient.query('SELECT * FROM projets WHERE id = $1', [projectId]);
            if (currentProject.rows.length === 0) {
                throw new Error('Project not found');
            }
            const current = currentProject.rows[0];

            const {
                nom_projet,
                date_limite,
                date_debut,
                description,
                file,
                adresse,
                cout,
                etat
            } = projectData;

            const updateProjectSql = `
                UPDATE projets SET
                    "Nom_Projet" = COALESCE($1, "Nom_Projet"),
                    "Date_Limite" = COALESCE($2, "Date_Limite"),
                    "Description" = COALESCE($3, "Description"),
                    file = COALESCE($4, file),
                    adresse = COALESCE($5, adresse),
                    "Cout" = COALESCE($6, "Cout"),
                    "Date_Debut" = COALESCE($7, "Date_Debut"),
                    etat = COALESCE($8, etat)
                WHERE id = $9
                RETURNING id
            `;

            const updateResult = await dbClient.query(updateProjectSql, [
                nom_projet || null,
                date_limite || null,
                description || null,
                file || null,
                adresse || null,
                cout || null,
                date_debut || null,
                etat || null,
                projectId
            ]);

            // Track changes and create event
            if (updateResult.rows.length > 0 && userId) {
                const changes = {};
                if (nom_projet && nom_projet !== current.Nom_Projet) changes.nom_projet = { from: current.Nom_Projet, to: nom_projet };
                if (date_limite && date_limite !== current.Date_Limite) changes.date_limite = { from: current.Date_Limite, to: date_limite };
                if (date_debut && date_debut !== current.Date_Debut) changes.date_debut = { from: current.Date_Debut, to: date_debut };
                if (description && description !== current.Description) changes.description = { from: current.Description, to: description };
                if (etat && etat !== current.etat) changes.etat = { from: current.etat, to: etat };
                if (cout && cout !== current.Cout) changes.cout = { from: current.Cout, to: cout };
                if (adresse && adresse !== current.adresse) changes.adresse = { from: current.adresse, to: adresse };

                // If caller requests suppression, return the diff to be consolidated by caller
                if (options && options.suppressEvent === true) {
                    if (useTransaction) await dbClient.query('COMMIT');
                    return { updated: true, changes };
                }

                if (Object.keys(changes).length > 0) {
                    try {
                        await EventNotificationService.projectUpdated(projectId, userId, changes, isUserAction);
                    } catch (eventError) {
                        console.error('Failed to create project update event:', eventError);
                    }
                }
            }

            if (useTransaction) await dbClient.query('COMMIT');
            // Maintain backward compat: if not suppressed, return boolean
            return updateResult.rows.length > 0;
        } catch (error) {
            if (useTransaction) await dbClient.query('ROLLBACK');
            throw error;
        } finally {
            if (useTransaction) dbClient.release();
        }
    }

    /**
     * Delete project
     */
    static async delete(projectId, userId = null, client = null) {
        const dbClient = client || await pool.connect();
        const useTransaction = !client;

        try {
            if (useTransaction) await dbClient.query('BEGIN');

            // Delete related data
            // 1) Delete notifications and events related to this project's blocs and project itself
            try {
                // Find all bloc ids associated with this project
                const { rows: blocRows } = await dbClient.query(
                    `SELECT DISTINCT b.id
                     FROM bloc b
                     INNER JOIN structure s ON s.bloc = b.id
                     INNER JOIN ouvrage o ON o.id = s.ouvrage
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE pl.id_projet = $1`,
                    [projectId]
                );
                const blocIds = blocRows.map(r => Number(r.id)).filter(n => Number.isFinite(n));

                // Delete notifications referencing events for this project
                await dbClient.query(
                    `DELETE FROM notifs WHERE event IN (
                        SELECT e.id_event FROM events e
                        WHERE e.projet = $1
                    )`,
                    [projectId]
                );

                // Delete notifications referencing events for these blocs
                if (blocIds.length > 0) {
                    await dbClient.query(
                        'DELETE FROM notifs WHERE event IN (SELECT id_event FROM events WHERE bloc = ANY($1::int[]))',
                        [blocIds]
                    );
                }

                // Delete events tied to this project
                await dbClient.query(
                    `DELETE FROM events WHERE projet = $1`,
                    [projectId]
                );

                // Delete events tied to these blocs
                if (blocIds.length > 0) {
                    await dbClient.query('DELETE FROM events WHERE bloc = ANY($1::int[])', [blocIds]);
                }
            } catch (cleanupError) {
                // Do not swallow errors: rethrow so transaction rolls back and surfaces clearly
                throw cleanupError;
            }

            // 2) Clean up gbloc references in events for all gblocs associated with this project
            try {
                // Find all ouvrages that were associated with this project
                const { rows: projectOuvrages } = await dbClient.query(
                    `SELECT DISTINCT o.id 
                     FROM ouvrage o 
                     WHERE EXISTS (
                         SELECT 1 FROM projet_article pa 
                         INNER JOIN structure s ON s.id_structure = pa.structure
                         INNER JOIN ouvrage o2 ON o2.id = s.ouvrage
                         INNER JOIN projet_lot pl ON pl.id_projet_lot = o2.projet_lot
                         WHERE s.ouvrage = o.id AND pl.id_projet = $1
                     )`,
                    [projectId]
                );
                const projectOuvrageIds = projectOuvrages.map(r => Number(r.id)).filter(n => Number.isFinite(n));

                if (projectOuvrageIds.length > 0) {
                    // Set ouvrage to NULL in events that reference these project ouvrages
                    await dbClient.query('UPDATE events SET ouvrage = NULL WHERE ouvrage = ANY($1::int[])', [projectOuvrageIds]);
                }
            } catch (cleanupProjectGblocEventsError) {
                throw cleanupProjectGblocEventsError;
            }

            // 3) Delete project associations
            await dbClient.query('DELETE FROM projet_equipe WHERE projet = $1', [projectId]);

            // Delete projet_article entries through the new schema (structure → ouvrage → projet_lot → projet)
            await dbClient.query(
                `DELETE FROM projet_article pa 
                 USING structure s, ouvrage o, projet_lot pl 
                 WHERE pa.structure = s.id_structure 
                 AND s.ouvrage = o.id 
                 AND o.projet_lot = pl.id_projet_lot 
                 AND pl.id_projet = $1`,
                [projectId]
            );

            // 2.2) After removing projet_article rows, some blocs may become orphaned. Clean up their events/notifs before deleting them.
            try {
                const { rows: orphanBlocs } = await dbClient.query(
                    `SELECT b.id FROM bloc b WHERE NOT EXISTS (SELECT 1 FROM projet_article pa INNER JOIN structure s ON s.id_structure = pa.structure WHERE s.bloc = b.id)`
                );
                const orphanIds = orphanBlocs.map(r => Number(r.id)).filter(n => Number.isFinite(n));
                if (orphanIds.length > 0) {
                    await dbClient.query(
                        'DELETE FROM notifs WHERE event IN (SELECT id_event FROM events WHERE bloc = ANY($1::int[]))',
                        [orphanIds]
                    );
                    await dbClient.query('DELETE FROM events WHERE bloc = ANY($1::int[])', [orphanIds]);
                }
            } catch (cleanupOrphansError) {
                throw cleanupOrphansError;
            }

            // 4) Delete orphan structure rows for this project, then orphan blocs and ouvrages
            await dbClient.query(
                `DELETE FROM structure s
                 USING ouvrage o, projet_lot pl
                 WHERE s.ouvrage = o.id
                   AND o.projet_lot = pl.id_projet_lot
                   AND pl.id_projet = $1
                   AND NOT EXISTS (SELECT 1 FROM projet_article pa WHERE pa.structure = s.id_structure)`,
                [projectId]
            );
            await dbClient.query('DELETE FROM bloc b WHERE NOT EXISTS (SELECT 1 FROM structure s WHERE s.bloc = b.id)');
            await dbClient.query('DELETE FROM ouvrage o WHERE NOT EXISTS (SELECT 1 FROM structure s WHERE s.ouvrage = o.id)');
            await dbClient.query('DELETE FROM projet_lot WHERE id_projet = $1', [projectId]);

            // 5) Delete project
            const result = await dbClient.query('DELETE FROM projets WHERE id = $1 RETURNING id', [projectId]);

            if (useTransaction) await dbClient.query('COMMIT');
            return result.rows.length > 0;
        } catch (error) {
            if (useTransaction) await dbClient.query('ROLLBACK');
            throw error;
        } finally {
            if (useTransaction) dbClient.release();
        }
    }

    /**
     * Check if user has access to project
     */
    static async checkUserAccess(projectId, userId, isAdmin = false) {
        if (typeof pool.connect === 'function') {
            const client = await pool.connect();
            try {
                if (isAdmin) {
                    const result = await client.query('SELECT id FROM projets WHERE id = $1', [projectId]);
                    return result.rows.length > 0;
                }

                const result = await client.query(
                    `SELECT p.id
             FROM projets p
             LEFT JOIN projet_equipe pe ON pe.projet = p.id AND pe.equipe = $2
             WHERE p.id = $1 AND (p."Ajouté_par" = $2 OR pe.id IS NOT NULL)`,
                    [projectId, userId]
                );
                return result.rows.length > 0;
            } finally {
                client.release();
            }
        } else {
            if (isAdmin) {
                const result = await pool.query('SELECT id FROM projets WHERE id = $1', [projectId]);
                return result.rows.length > 0;
            }
            const result = await pool.query(
                `SELECT p.id
                 FROM projets p
                 LEFT JOIN projet_equipe pe ON pe.projet = p.id AND pe.equipe = $2
                 WHERE p.id = $1 AND (p."Ajouté_par" = $2 OR pe.id IS NOT NULL)`,
                [projectId, userId]
            );
            return result.rows.length > 0;
        }
    }

    /**
     * Get project team members
     */
    static async getTeamMembers(projectId) {
        const query = `
            SELECT u.id, u.nom_utilisateur, u.email
            FROM projet_equipe pe
            JOIN users u ON pe.equipe = u.id
            WHERE pe.projet = $1
        `;
        if (typeof pool.connect === 'function') {
            const client = await pool.connect();
            try {
                const result = await client.query(query, [projectId]);
                return result.rows;
            } finally {
                client.release();
            }
        } else {
            const result = await pool.query(query, [projectId]);
            return result.rows;
        }
    }


    /**
     * Update project team
     */
    static async updateTeam(projectId, userIds, updatedBy = null, client = null, options = {}) {
        const dbClient = client || await pool.connect();
        const useTransaction = !client;
        // When called with an external client (inside a larger transaction),
        // let the outer layer decide when to emit events after COMMIT.
        const suppressEvent = options?.suppressEvent === true || !!client;

        try {
            if (useTransaction) await dbClient.query('BEGIN');

            // Get current team for change tracking
            let currentTeam = [];
            if (updatedBy) {
                const currentResult = await dbClient.query('SELECT equipe FROM projet_equipe WHERE projet = $1', [projectId]);
                currentTeam = currentResult.rows.map(row => row.equipe);
            }

            // Delete existing team
            await dbClient.query('DELETE FROM projet_equipe WHERE projet = $1', [projectId]);

            if (userIds && userIds.length > 0) {
                // Get next ID
                const maxEquipeIdResult = await dbClient.query('SELECT COALESCE(MAX("id"), 0) as max_id FROM projet_equipe');
                let nextEquipeId = maxEquipeIdResult.rows[0].max_id + 1;

                // Insert new team members
                for (const userId of userIds) {
                    await dbClient.query(
                        `INSERT INTO projet_equipe ("id", equipe, projet) VALUES ($1, $2, $3)`,
                        [nextEquipeId++, userId, projectId]
                    );
                }
            }

            // Create event and notifications
            if (updatedBy && !suppressEvent) {
                const newTeam = userIds || [];
                const added = newTeam.filter(id => !currentTeam.includes(id));
                const removed = currentTeam.filter(id => !newTeam.includes(id));

                if (added.length > 0 || removed.length > 0) {
                    try {
                        await EventNotificationService.teamUpdated(projectId, updatedBy, { added, removed });
                    } catch (eventError) {
                        console.error('Failed to create team update event:', eventError);
                    }
                }
            }

            // If part of a combined update, return diff so caller can include in consolidated event
            if (updatedBy && suppressEvent) {
                const newTeam = userIds || [];
                const added = newTeam.filter(id => !currentTeam.includes(id));
                const removed = currentTeam.filter(id => !newTeam.includes(id));
                return { added, removed };
            }

            if (useTransaction) await dbClient.query('COMMIT');
            return true;
        } catch (error) {
            if (useTransaction) await dbClient.query('ROLLBACK');
            throw error;
        } finally {
            if (useTransaction) dbClient.release();
        }
    }

    /**
     * Upsert client for project
     */
    static async upsertClient(projectId, clientData, client = null) {
        const dbClient = client || await pool.connect();
        const useTransaction = !client;

        try {
            if (useTransaction) await dbClient.query('BEGIN');

            const { client_nom, client_marge_brut, client_marge_net } = clientData;

            // Check if client table exists
            const hasClientTable = await dbClient.query(`SELECT to_regclass('public.client') AS t`);
            if (!hasClientTable.rows[0]?.t) {
                if (useTransaction) await dbClient.query('COMMIT');
                return null;
            }

            // Get project's current client
            const projectResult = await dbClient.query('SELECT client FROM projets WHERE id = $1', [projectId]);
            const currentClientId = projectResult.rows[0]?.client;

            let newClientId = currentClientId || null;
            const changes = {};

            // Fetch current client values (if any) to build a diff
            let currentClientRow = null;
            if (currentClientId) {
                const currentClientRes = await dbClient.query(
                    'SELECT nom_client, marge_brut, marge_net FROM client WHERE id = $1',
                    [currentClientId]
                );
                currentClientRow = currentClientRes.rows[0] || null;
            }

            if (client_nom || client_marge_brut !== undefined || client_marge_net !== undefined) {
                if (currentClientId) {
                    // Track changes against existing client
                    const oldNom = currentClientRow?.nom_client ?? null;
                    if (client_nom !== undefined && client_nom !== oldNom) {
                        changes.client_nom = { from: oldNom, to: client_nom };
                    }

                    // Update existing client
                    await dbClient.query(
                        `UPDATE client SET 
                            nom_client = COALESCE($1, nom_client),
                            marge_brut = COALESCE($2, marge_brut),
                            marge_net = COALESCE($3, marge_net)
                         WHERE id = $4`,
                        [client_nom, client_marge_brut, client_marge_net, currentClientId]
                    );
                    newClientId = currentClientId;
                } else {
                    // Creating a new client: treat previous values as null for diff
                    if (client_nom !== undefined) {
                        changes.client_nom = { from: null, to: client_nom };
                    }
                    if (client_marge_brut !== undefined) {
                        changes.client_marge_brut = { from: null, to: client_marge_brut };
                    }
                    if (client_marge_net !== undefined) {
                        changes.client_marge_net = { from: null, to: client_marge_net };
                    }

                    // Create new client
                    const insertResult = await dbClient.query(
                        `INSERT INTO client (nom_client, marge_brut, marge_net) 
                         VALUES ($1, $2, $3) RETURNING id`,
                        [client_nom, client_marge_brut, client_marge_net]
                    );
                    newClientId = insertResult.rows[0].id;
                }

                // Update project with client ID
                if (newClientId !== null && newClientId !== currentClientId) {
                    await dbClient.query('UPDATE projets SET client = $1 WHERE id = $2', [newClientId, projectId]);
                }
            }

            if (useTransaction) await dbClient.query('COMMIT');
            return { clientId: newClientId, changes };
        } catch (error) {
            if (useTransaction) await dbClient.query('ROLLBACK');
            throw error;
        } finally {
            if (useTransaction) dbClient.release();
        }
    }

    // ==================== GBLOCS ====================

    /**
     * Create a grand bloc (gbloc) for a project
     */
    static async createGbloc(projectId, { lot, niveau3, designation, prix_total = null, child_bloc }, userId, isAdmin) {
        const client = await pool.connect();
        try {
            // Verify access
            const accessCheckSql = isAdmin
                ? 'SELECT id FROM projets WHERE id = $1'
                : `SELECT p.id FROM projets p LEFT JOIN projet_equipe pe ON pe.projet = p.id AND pe.equipe = $2
                   WHERE p.id = $1 AND (p."Ajouté_par" = $2 OR pe.id IS NOT NULL)`;
            const accessArgs = isAdmin ? [projectId] : [projectId, userId];
            const access = await client.query(accessCheckSql, accessArgs);
            if (access.rows.length === 0) {
                throw new Error('Project not found or access denied');
            }

            await client.query('BEGIN');

            if (lot === null || lot === undefined || (typeof lot === 'string' && lot.trim() === '')) {
                throw new Error('lot is required');
            }

            const resolvedLotId = await ensureLotId(client, lot);
            if (!resolvedLotId) {
                throw new Error('Unable to resolve lot identifier');
            }

            // Ensure projet_lot entry exists and get the id_projet_lot
            let projetLotResult = await client.query(
                'SELECT id_projet_lot FROM projet_lot WHERE id_projet = $1 AND id_lot = $2',
                [projectId, resolvedLotId]
            );

            let projetLotId;
            if (projetLotResult.rows.length === 0) {
                // Create projet_lot entry if it doesn't exist
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

                const newProjetLot = await client.query(
                    'INSERT INTO projet_lot (id_projet_lot, id_projet, id_lot, designation_lot) VALUES ($1, $2, $3, $4) RETURNING id_projet_lot',
                    [nextId, projectId, resolvedLotId, designationLot]
                );
                projetLotId = newProjetLot.rows[0].id_projet_lot;
            } else {
                projetLotId = projetLotResult.rows[0].id_projet_lot;
            }

            // Don't automatically calculate lot designation - use NULL or let user set it manually
            const designationLotCheck = await client.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'projet_article' AND column_name = 'designation_lot'
            `);
            const hasDesignationLot = designationLotCheck.rows.length > 0;
            let lotDesignation = null; // User can set it manually via updateDesignation

            // ✅ FIX: Try to get existing lot designation if lot is already present
            if (resolvedLotId && hasDesignationLot) {
                const existingLotDes = await client.query(
                    `SELECT pa.designation_lot 
                     FROM projet_article pa
                     INNER JOIN structure s ON s.id_structure = pa.structure
                     INNER JOIN ouvrage o ON o.id = s.ouvrage
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE pl.id_projet = $1 AND pl.id_lot = $2 AND pa.designation_lot IS NOT NULL 
                     LIMIT 1`,
                    [projectId, resolvedLotId]
                );
                if (existingLotDes.rows.length > 0) {
                    lotDesignation = existingLotDes.rows[0].designation_lot;
                }
            }

            let row;
            const nom_bloc = niveau3;
            if (!nom_bloc || String(nom_bloc).trim() === '') {
                throw new Error('niveau3 is required for gbloc creation');
            }

            // Allow creating an ouvrage with the same name and associating the same lot.
            // Uniqueness is enforced per specific ouvrage record, not across same-named ouvrages.

            // Use provided designation or calculate if not provided
            // Pass lotId so each lot has its own independent numbering
            const DesignationHelper = require('../utils/designationHelper');
            let ouvrageDesignation = designation && String(designation).trim()
                ? String(designation).trim()
                : await DesignationHelper.getNextOuvrageDesignation(client, projectId, resolvedLotId);



            // Try with default first, fallback to manual ID if duplicate key error
            await client.query('SAVEPOINT insert_ouvrage');
            try {
                const ins = await client.query(
                    'INSERT INTO ouvrage (nom_ouvrage, prix_total, designation, projet_lot) VALUES ($1, $2, $3, $4) RETURNING id, nom_ouvrage, prix_total, designation',
                    [String(nom_bloc).trim(), Number(prix_total ?? 0), ouvrageDesignation, projetLotId]
                );
                row = ins.rows[0];
                await client.query('RELEASE SAVEPOINT insert_ouvrage');
            } catch (insertError) {
                // If default fails, rollback to savepoint and try with manual ID
                await client.query('ROLLBACK TO SAVEPOINT insert_ouvrage');

                // Get the current maximum ID and add 1, but ensure it's higher than any sequence value
                const maxRes = await client.query('SELECT COALESCE(MAX(id), 0) AS max_id FROM ouvrage');
                const seqExistsRes = await client.query("SELECT to_regclass('ouvrage_id_seq') as seq");
                const maxId = maxRes.rows[0].max_id;
                let sequenceValue = 0;
                if (seqExistsRes.rows[0]?.seq) {
                    const sequenceRes = await client.query("SELECT last_value FROM ouvrage_id_seq");
                    sequenceValue = sequenceRes.rows[0]?.last_value || 0;
                }
                const nextId = Math.max(maxId, sequenceValue) + 1;

                const ins2 = await client.query(
                    'INSERT INTO ouvrage (id, nom_ouvrage, prix_total, designation, projet_lot) VALUES ($1, $2, $3, $4, $5) RETURNING id, nom_ouvrage, prix_total, designation',
                    [nextId, String(nom_bloc).trim(), Number(prix_total ?? 0), ouvrageDesignation, projetLotId]
                );
                row = ins2.rows[0];
            }

            // ✅ Post-creation conflict check: Ensure ouvrage ID doesn't conflict with any bloc ID
            const { getNextAvailableOuvrageId } = require('../utils/idConflictResolver');
            const safeOuvrageId = await getNextAvailableOuvrageId(row.id);
            if (safeOuvrageId !== row.id) {
                console.warn(`⚠️ Post-creation conflict detected: ouvrage.id (${row.id}) conflicts with bloc IDs`);

                // Update ouvrage with the safe ID
                await client.query(
                    'UPDATE ouvrage SET id = $1 WHERE id = $2',
                    [safeOuvrageId, row.id]
                );

                console.log(`✅ Ouvrage ID changed: ${row.id} → ${safeOuvrageId} to avoid conflict with bloc IDs`);
                row.id = safeOuvrageId;
            }

            // Optionally create a child bloc
            let createdChildBloc = null;
            if (child_bloc && typeof child_bloc === 'object' && child_bloc.nom_bloc && String(child_bloc.nom_bloc).trim() !== '') {
                const { nom_bloc: childNom, unite = null, quantite = null } = child_bloc;

                const blocIdCheck = await client.query(`
                    SELECT column_default FROM information_schema.columns
                    WHERE table_name = 'bloc' AND column_name = 'id'
                `);

                if (blocIdCheck.rows[0]?.column_default) {
                    const insB = await client.query(
                        'INSERT INTO bloc (nom_bloc, unite, quantite, pu, pt, designation) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
                        [String(childNom).trim(), unite, quantite, null, null, null]
                    );
                    createdChildBloc = insB.rows[0];
                } else {
                    const maxB = await client.query('SELECT COALESCE(MAX(id), 0) AS max_id FROM bloc');
                    const nextB = maxB.rows[0].max_id + 1;
                    const insB2 = await client.query(
                        'INSERT INTO bloc (id, nom_bloc, unite, quantite, pu, pt, designation) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
                        [nextB, String(childNom).trim(), unite, quantite, null, null, null]
                    );
                    createdChildBloc = insB2.rows[0];
                }
            }


            try {
                await client.query('SAVEPOINT sp_pa');

                // Declare variables for structure IDs
                let structureId;
                let blocStructureId;

                // First, ensure the ouvrage has the correct projet_lot reference
                if (resolvedLotId) {
                    // Find the projet_lot entry for this project and lot
                    const projetLotRes = await client.query(
                        `SELECT id_projet_lot FROM projet_lot WHERE id_projet = $1 AND id_lot = $2`,
                        [projectId, resolvedLotId]
                    );

                    let projetLotId;
                    if (projetLotRes.rows.length === 0) {
                        // Create projet_lot entry if it doesn't exist
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

                        const newProjetLot = await client.query(
                            `INSERT INTO projet_lot (id_projet_lot, id_projet, id_lot, designation_lot) VALUES ($1, $2, $3, $4) RETURNING id_projet_lot`,
                            [nextId, projectId, resolvedLotId, designationLot]
                        );
                        projetLotId = newProjetLot.rows[0].id_projet_lot;
                    } else {
                        projetLotId = projetLotRes.rows[0].id_projet_lot;
                    }

                    // Update the ouvrage with the projet_lot reference
                    await client.query(
                        `UPDATE ouvrage SET projet_lot = $1 WHERE id = $2`,
                        [projetLotId, row.id]
                    );

                    // Find or create structure entry for this ouvrage (no bloc yet)
                    const Structure = require('./Structure');
                    structureId = await Structure.findOrCreate(row.id, null, client);



                    // Handle child bloc if created
                    if (createdChildBloc?.id) {
                        // Find or create structure entry for ouvrage + bloc combination
                        blocStructureId = await Structure.findOrCreate(row.id, createdChildBloc.id, client);
                    }
                } else {
                    // No lot specified - handle ouvrage without lot
                    // Find or create structure entry for this ouvrage (no bloc, no lot)
                    const Structure = require('./Structure');
                    structureId = await Structure.findOrCreate(row.id, null, client);

                    // Handle child bloc if created
                    if (createdChildBloc?.id) {
                        // Find or create structure entry for ouvrage + bloc combination
                        blocStructureId = await Structure.findOrCreate(row.id, createdChildBloc.id, client);
                    }
                }
                await client.query('RELEASE SAVEPOINT sp_pa');
            } catch (e) {
                try { await client.query('ROLLBACK TO SAVEPOINT sp_pa'); } catch { }
                throw e;
            }

            // Recalculate project's selling price after gbloc creation (inside transaction)
            // Even though no articles are added yet (total_ttc is NULL), this ensures consistency
            // Recalculate project's selling price after gbloc creation (inside transaction)
            // Even though no articles are added yet (total_ttc is NULL), this ensures consistency
            // Unify logic with deleteBloc/addArticle
            await this.recalculatePrixVente(projectId, client);
            console.log('✅ Recalculated prix_vente after creating gbloc (ouvrage)');

            await client.query('COMMIT');

            // Recalculate designations for this specific lot based on the provided designation
            // Pass the newly created ouvrage ID and lot ID so it gets the starting designation
            // Each lot has its own independent numbering system
            if (designation && String(designation).trim()) {
                try {
                    await DesignationHelper.recalculateProjectDesignations(projectId, null, String(designation).trim(), row.id, resolvedLotId);
                } catch (recalcError) {
                    console.error('Error recalculating designations:', recalcError);
                    // Don't throw - the ouvrage was created successfully
                }
            }

            // Validate that the ouvrage was actually created before logging event
            let validatedOuvrageId = null;
            if (row && row.id) {
                try {
                    const validationResult = await client.query('SELECT id FROM ouvrage WHERE id = $1', [row.id]);
                    if (validationResult.rows.length > 0) {
                        validatedOuvrageId = row.id;
                    } else {
                        console.error('❌ Ouvrage creation validation failed: ID', row.id, 'not found in database');
                    }
                } catch (validationError) {
                    console.error('❌ Error validating ouvrage creation:', validationError);
                }
            }

            // Create event and notifications asynchronously (non-blocking) only if ouvrage was validated
            if (validatedOuvrageId) {
                setImmediate(() => {
                    console.log('🔔 Creating gbloc event:', { projectId, gblocId: validatedOuvrageId, userId, nom_bloc, hasBloc: !!createdChildBloc });
                    EventNotificationService.gblocCreated(projectId, validatedOuvrageId, userId, {
                        nom_ouvrage: nom_bloc, // Use nom_ouvrage for ouvrage name
                        nom_bloc: nom_bloc, // Keep for backward compatibility
                        prix_total,
                        lot: String(lot),
                        bloc_name: createdChildBloc?.nom_bloc || null,
                        blocId: createdChildBloc?.id || null
                    }).then(() => {
                        console.log('✅ Gbloc event created successfully');
                    }).catch(eventError => {
                        console.error('❌ Failed to create gbloc creation event:', eventError);
                    });
                });
            } else {
                console.error('❌ Skipping event creation due to ouvrage validation failure');
            }

            return { ...row, child_bloc: createdChildBloc };
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch { }
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Create a lot under a gbloc
     */
    static async createLotUnderGbloc(projectId, gblocId, { lot, nom_bloc, unite = null, quantite = null, designation = null }, userId, isAdmin) {
        const client = await pool.connect();
        try {
            // Verify gbloc exists and user has access
            const accessCheckSql = isAdmin
                ? 'SELECT o.id FROM ouvrage o WHERE o.id = $1'
                : `SELECT o.id FROM ouvrage o 
                   LEFT JOIN projets p ON p.id = $2
                   LEFT JOIN projet_equipe pe ON pe.projet = p.id AND pe.equipe = $3
                   WHERE o.id = $1 AND (p."Ajouté_par" = $3 OR pe.id IS NOT NULL)`;
            const accessArgs = isAdmin ? [gblocId] : [gblocId, projectId, userId];
            const access = await client.query(accessCheckSql, accessArgs);
            if (access.rows.length === 0) {
                throw new Error('Gbloc not found or access denied');
            }

            if (!lot || String(lot).trim() === '') {
                throw new Error('lot is required');
            }

            const resolvedLotId = await ensureLotId(client, lot);
            if (!resolvedLotId) {
                throw new Error('Unable to resolve lot identifier');
            }

            // Get lot designation (provided or fetched)
            let lotDesignation = designation && String(designation).trim() ? String(designation).trim() : null;
            if (!lotDesignation && resolvedLotId) {
                const existingLotDes = await client.query(
                    `SELECT pa.designation_lot 
                     FROM projet_article pa
                     INNER JOIN structure s ON s.id_structure = pa.structure
                     INNER JOIN ouvrage o ON o.id = s.ouvrage
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE pl.id_projet = $1 AND pl.id_lot = $2 AND pa.designation_lot IS NOT NULL 
                     LIMIT 1`,
                    [projectId, resolvedLotId]
                );
                if (existingLotDes.rows.length > 0) {
                    lotDesignation = existingLotDes.rows[0].designation_lot;
                }
            }

            await client.query('BEGIN');

            // Check if lot already exists under this gbloc
            const existingLot = await client.query(
                `SELECT DISTINCT pl.id_lot AS lot
                 FROM projet_article pa
                 INNER JOIN structure s ON s.id_structure = pa.structure
                 INNER JOIN ouvrage o ON o.id = s.ouvrage
                 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 WHERE pl.id_projet = $1 AND pl.id_lot = $2 AND s.ouvrage = $3`,
                [projectId, resolvedLotId, gblocId]
            );

            if (existingLot.rows.length > 0) {
                throw new Error('Lot already exists in this ouvrage');
            }

            // Create the bloc only if nom_bloc is provided
            let createdBloc = null;
            if (nom_bloc && String(nom_bloc).trim() !== '') {
                const blocIdCheck = await client.query(`
                    SELECT column_default FROM information_schema.columns
                    WHERE table_name = 'bloc' AND column_name = 'id'
                `);

                if (blocIdCheck.rows[0]?.column_default) {
                    const insB = await client.query(
                        'INSERT INTO bloc (nom_bloc, unite, quantite, pu, pt, designation) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
                        [String(nom_bloc).trim(), unite, quantite, null, null, null]
                    );
                    createdBloc = insB.rows[0];
                } else {
                    const maxB = await client.query('SELECT COALESCE(MAX(id), 0) AS max_id FROM bloc');
                    const nextB = maxB.rows[0].max_id + 1;
                    const insB2 = await client.query(
                        'INSERT INTO bloc (id, nom_bloc, unite, quantite, pu, pt, designation) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
                        [nextB, String(nom_bloc).trim(), unite, quantite, null, null, null]
                    );
                    createdBloc = insB2.rows[0];
                }
            }


            // Link ouvrage to lot via projet_lot and create structure entry for the new bloc
            if (createdBloc?.id) {
                let projetLotId;
                const projetLotRes = await client.query(
                    `SELECT id_projet_lot FROM projet_lot WHERE id_projet = $1 AND id_lot = $2`,
                    [projectId, resolvedLotId]
                );
                if (projetLotRes.rows.length === 0) {
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
                    const newProjetLot = await client.query(
                        'INSERT INTO projet_lot (id_projet_lot, id_projet, id_lot, designation_lot) VALUES ($1, $2, $3, $4) RETURNING id_projet_lot',
                        [nextId, projectId, resolvedLotId, designationLot]
                    );
                    projetLotId = newProjetLot.rows[0].id_projet_lot;
                } else {
                    projetLotId = projetLotRes.rows[0].id_projet_lot;
                }
                await client.query('UPDATE ouvrage SET projet_lot = $1 WHERE id = $2', [projetLotId, gblocId]);

                const structRes = await client.query(
                    `SELECT id_structure FROM structure WHERE ouvrage = $1 AND bloc = $2`,
                    [gblocId, createdBloc.id]
                );
                if (structRes.rows.length === 0) {
                    const structDefault = await client.query(`
                        SELECT column_default FROM information_schema.columns
                        WHERE table_name = 'structure' AND column_name = 'id_structure'
                    `);
                    if (structDefault.rows[0]?.column_default) {
                        await client.query(
                            `INSERT INTO structure (ouvrage, bloc) VALUES ($1, $2)`,
                            [gblocId, createdBloc.id]
                        );
                    } else {
                        const nextStructIdRes = await client.query('SELECT COALESCE(MAX(id_structure), 0) + 1 AS next_id FROM structure');
                        const nextStructId = nextStructIdRes.rows[0].next_id;
                        await client.query(
                            `INSERT INTO structure (id_structure, ouvrage, bloc) VALUES ($1, $2, $3)`,
                            [nextStructId, gblocId, createdBloc.id]
                        );
                    }
                }
            }

            await client.query('COMMIT');

            // Create events for lot and bloc creation AFTER commit
            setImmediate(async () => {
                try {
                    // Create lot event with ouvrage context
                    await EventNotificationService.lotCreated(projectId, userId, {
                        name: lotLabel,
                        gblocId
                    });
                    console.log('✅ Lot event created successfully');

                    // Create bloc event if bloc was created
                    if (createdBloc) {
                        await EventNotificationService.blocCreated(projectId, createdBloc.id, userId, {
                            nom_bloc: createdBloc.nom_bloc,
                            unite: createdBloc.unite,
                            quantite: createdBloc.quantite,
                            lot: lotLabel,
                            g_bloc: gblocId
                        });
                        console.log('✅ Bloc event created successfully');
                    }
                } catch (eventError) {
                    console.error('❌ Failed to create lot/bloc events:', eventError);
                }
            });

            return createdBloc;
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch { }
            throw error;
        } finally {
            client.release();
        }
    }

    // ==================== BLOCS ====================

    /**
     * Persist drag-and-drop ordering for gblocs and standalone lots in a project.
     * The order parameter comes from the frontend and may contain items of type:
     * - 'gbloc' with gblocId or id
     * - 'lot' with lotName (standalone lots only)
     */
    static async reorderBlocs(projectId, order, userId, isAdmin) {
        console.warn('reorderBlocs: project_structure_order support disabled — skipping custom ordering.');
        return true;
    }

    /**
     * Get all blocs for a project
     * Uses project_structure_order to respect custom drag-and-drop order
     * for gblocs and standalone lots.
     */
    static async getBlocs(projectId, userId, isAdmin) {
        const client = await pool.connect();
        try {
            const accessCheckSql = isAdmin
                ? 'SELECT id FROM projets WHERE id = $1'
                : `SELECT p.id FROM projets p LEFT JOIN projet_equipe pe ON pe.projet = p.id AND pe.equipe = $2
                   WHERE p.id = $1 AND (p."Ajouté_par" = $2 OR pe.id IS NOT NULL)`;
            const accessArgs = isAdmin ? [projectId] : [projectId, userId];
            const access = await client.query(accessCheckSql, accessArgs);
            if (access.rows.length === 0) {
                throw new Error('Project not found or access denied');
            }

            const { rows } = await client.query(
                `SELECT
                        b.id,
                        b.nom_bloc,
                        COALESCE(NULLIF(pl.id_lot, ''), '') AS lot,
                        COALESCE(s.ouvrage, NULL) AS g_bloc,
                        COALESCE(o.nom_ouvrage, NULL) AS gbloc_nom,
                        COALESCE(o.prix_total, NULL) AS gbloc_prix_total,
                        COALESCE(s.action, 'bloc') AS action,
                        b.unite,
                        b.quantite,
                        b.pu,
                        b.pt
                 FROM bloc b
                 LEFT JOIN structure s ON s.bloc = b.id
                 INNER JOIN ouvrage o ON o.id = s.ouvrage
                 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 WHERE pl.id_projet = $1
                 GROUP BY
                        b.id,
                        b.nom_bloc,
                        pl.id_lot,
                        s.ouvrage,
                        o.nom_ouvrage,
                        o.prix_total,
                        b.unite,
                        b.quantite,
                        b.pu,
                        b.pt
                 ORDER BY
                        (s.ouvrage IS NULL),
                        COALESCE(s.ouvrage, 2147483647),
                        pl.id_lot,
                        b.nom_bloc`,
                [projectId]
            );

            return rows;
        } finally {
            client.release();
        }
    }

    /**
     * Get bloc totals for a project
     */
    static async getBlocTotals(projectId, userId, isAdmin) {
        const client = await pool.connect();
        try {
            const accessCheckSql = isAdmin
                ? 'SELECT id FROM projets WHERE id = $1'
                : `SELECT p.id FROM projets p LEFT JOIN projet_equipe pe ON pe.projet = p.id AND pe.equipe = $2
                   WHERE p.id = $1 AND (p."Ajouté_par" = $2 OR pe.id IS NOT NULL)`;
            const accessArgs = isAdmin ? [projectId] : [projectId, userId];
            const access = await client.query(accessCheckSql, accessArgs);
            if (access.rows.length === 0) {
                throw new Error('Project not found or access denied');
            }

            const { rows } = await client.query(
                `SELECT b.id AS bloc,
                        COALESCE(SUM(CASE WHEN pa.article IS NOT NULL THEN pa.total_ttc ELSE 0 END), 0)::float AS total_ttc,
                        COUNT(pa.article)::int AS articles_count,
                        b.quantite::int, b.unite,
                        CASE WHEN COALESCE(b.quantite, 0) > 0 THEN (
                            COALESCE(SUM(CASE WHEN pa.article IS NOT NULL THEN pa.total_ttc ELSE 0 END), 0)::float / b.quantite
                        )::float ELSE NULL END AS pu,
                        COALESCE(SUM(CASE WHEN pa.article IS NOT NULL THEN pa.total_ttc ELSE 0 END), 0)::float AS pt
                 FROM bloc b
                 LEFT JOIN structure s ON s.bloc = b.id
                 INNER JOIN ouvrage o ON o.id = s.ouvrage
                 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 LEFT JOIN projet_article pa ON pa.structure = s.id_structure
                 WHERE pl.id_projet = $1
                 GROUP BY b.id, b.quantite, b.unite`,
                [projectId]
            );
            return rows;
        } finally {
            client.release();
        }
    }

    // ==================== ARTICLES ====================

    /**
     * Get articles for a bloc
     */
    static async getBlocArticles(projectId, blocId, userId, isAdmin, ouvrageId = null) {
        const client = await pool.connect();
        try {
            const accessCheckSql = isAdmin
                ? 'SELECT id FROM projets WHERE id = $1'
                : `SELECT p.id FROM projets p LEFT JOIN projet_equipe pe ON pe.projet = p.id AND pe.equipe = $2
                   WHERE p.id = $1 AND (p."Ajouté_par" = $2 OR pe.id IS NOT NULL)`;
            const accessArgs = isAdmin ? [projectId] : [projectId, userId];
            const access = await client.query(accessCheckSql, accessArgs);
            if (access.rows.length === 0) {
                throw new Error('Project not found or access denied');
            }

            // If ouvrageId is not provided, get it from the first projet_article entry for this bloc
            // This ensures we only get articles from one ouvrage, even if the bloc ID is reused in multiple ouvrages
            if (ouvrageId === null) {
                const ouvrageResult = await client.query(
                    `SELECT DISTINCT s.ouvrage FROM projet_article pa
                     INNER JOIN structure s ON s.id_structure = pa.structure
                     INNER JOIN ouvrage o ON o.id = s.ouvrage
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE pl.id_projet = $1 AND s.bloc = $2 AND s.ouvrage IS NOT NULL 
                     LIMIT 1`,
                    [projectId, blocId]
                );
                if (ouvrageResult.rows.length > 0) {
                    ouvrageId = ouvrageResult.rows[0].ouvrage;
                }
            }

            // Build WHERE clause with ouvrage filter
            // Always filter by ouvrage to prevent mixing articles from different ouvrages with the same bloc ID
            // IMPORTANT: Explicitly exclude articles with bloc IS NULL (those belong directly to ouvrage)
            let whereClause = 'pl.id_projet = $1 AND s.bloc = $2 AND s.bloc IS NOT NULL AND pa.article IS NOT NULL';
            const queryParams = [projectId, blocId];

            if (ouvrageId !== null) {
                // Filter by specific ouvrage to ensure we only get articles from this ouvrage
                whereClause += ' AND s.ouvrage = $3';
                queryParams.push(ouvrageId);
            } else {
                // If no ouvrage found, filter for NULL ouvrage only
                // This ensures we don't mix articles from different ouvrages
                whereClause += ' AND s.ouvrage IS NULL';
            }

            const { rows } = await client.query(
                `SELECT pa.id, pa.article, pa.quantite, pa.prix_total_ht, pa.tva, pa.total_ttc,
                        pa.localisation, pa.description, pl.id_lot as lot, s.ouvrage as g_bloc, s.bloc, pa.nouv_prix,
                        COALESCE(pa.designation_article, a."nom_article") AS nom_article,
                        a."Unite" AS unite,
                        a."Date" AS date_article
                 FROM projet_article pa
                 LEFT JOIN structure s ON s.id_structure = pa.structure
                 LEFT JOIN ouvrage o ON o.id = s.ouvrage
                 LEFT JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 LEFT JOIN articles a ON a."ID" = pa.article
                 WHERE ${whereClause}
                 ORDER BY pa.id`,
                queryParams
            );
            return rows;
        } finally {
            client.release();
        }
    }

    /**
     * Add article to a bloc
     */
    static async addArticleToBloc(projectId, blocId, articleData, userId, isAdmin) {
        const { articleId, quantite = 1, prix_unitaire = 0, tva = 0, localisation = '', description = '', lot = null, g_bloc = null, nouv_prix = null, designation_lot = null } = articleData;

        // If prix_unitaire is 0, try to get the default price from the article catalog
        let finalPrixUnitaire = prix_unitaire;
        if (finalPrixUnitaire === 0) {
            try {
                const articleResult = await pool.query(
                    `SELECT 
                        CASE 
                            WHEN NULLIF("PU_Result"::text, '') IS NOT NULL THEN "PU_Result"
                            WHEN NULLIF("PU"::text, '') IS NOT NULL THEN "PU"
                            ELSE 0
                        END AS pu
                     FROM articles WHERE "ID" = $1 LIMIT 1`,
                    [articleId]
                );
                if (articleResult.rows.length > 0 && articleResult.rows[0].pu !== null) {
                    finalPrixUnitaire = Number(articleResult.rows[0].pu) || 0;
                    console.log(`Using default price from catalog: ${finalPrixUnitaire} for article ${articleId}`);
                }
            } catch (priceError) {
                console.warn(`Could not fetch default price for article ${articleId}:`, priceError.message);
            }
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            let finalBlocId = blocId === 0 ? null : blocId;
            let finalGblocId = g_bloc;
            let finalLotId = lot;
            let blocDesignationValue = null;

            if (finalBlocId) {
                // Validate bloc exists and get its lot and ouvrage information
                let blocInfo;
                if (finalGblocId) {
                    // Use both bloc and ouvrage to locate the specific context
                    blocInfo = await client.query(
                        `SELECT b.id, pl.id_lot as lot, s.ouvrage, b.designation 
                         FROM bloc b 
                         LEFT JOIN structure s ON s.bloc = b.id
                         INNER JOIN ouvrage o ON o.id = s.ouvrage
                         INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                         WHERE b.id = $2 AND s.ouvrage = $3 AND pl.id_projet = $1
                         LIMIT 1`,
                        [projectId, finalBlocId, finalGblocId]
                    );
                } else {
                    // Fallback: try to find any occurrence if ouvrage not specified (legacy behavior, but less safe)
                    blocInfo = await client.query(
                        `SELECT b.id, pl.id_lot as lot, s.ouvrage, b.designation 
                         FROM bloc b 
                         LEFT JOIN structure s ON s.bloc = b.id
                         INNER JOIN ouvrage o ON o.id = s.ouvrage
                         INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                         WHERE b.id = $2 AND pl.id_projet = $1
                         LIMIT 1`,
                        [projectId, finalBlocId]
                    );
                }

                if (blocInfo.rows.length === 0) {
                    // If filtering by ouvrage failed, maybe the bloc exists but not in this ouvrage?
                    if (finalGblocId) {
                        const checkAny = await client.query('SELECT id FROM bloc WHERE id = $1', [finalBlocId]);
                        if (checkAny.rows.length > 0) {
                            throw new Error(`Le bloc n'appartient pas à l'ouvrage spécifié`);
                        }
                    }
                    throw new Error('Bloc introuvable');
                }

                // Determine the lot for this article if not provided
                if (!finalLotId && blocInfo.rows[0].lot) {
                    finalLotId = blocInfo.rows[0].lot;
                }

                // Determine the ouvrage (gbloc) for this article if not provided
                if (!finalGblocId && blocInfo.rows[0].ouvrage) {
                    finalGblocId = blocInfo.rows[0].ouvrage;
                }

                // Capture bloc designation
                if (blocInfo.rows[0].designation && String(blocInfo.rows[0].designation).trim() !== '') {
                    blocDesignationValue = String(blocInfo.rows[0].designation).trim();
                }
            } else {
                // Adding directly to ouvrage
                if (!finalGblocId) {
                    throw new Error('ID d\'ouvrage (g_bloc) requis pour l\'ajout direct');
                }

                // Verify ouvrage exists
                const ouvrageCheck = await client.query('SELECT id FROM ouvrage WHERE id = $1', [finalGblocId]);
                if (ouvrageCheck.rows.length === 0) {
                    throw new Error('Ouvrage introuvable');
                }
            }

            // Get lot name if lot ID is provided (for legacy compatibility)
            let lotName = null;
            if (finalLotId) {
                const lotResult = await client.query('SELECT niveau_2 FROM niveau_2 WHERE id_niveau_2 = $1', [finalLotId]);
                if (lotResult.rows.length > 0) {
                    lotName = lotResult.rows[0].niveau_2;
                }
            }

            // Validate article exists and get its name
            const artResult = await client.query('SELECT "nom_article" FROM articles WHERE "ID" = $1 LIMIT 1', [parseInt(articleId, 10)]);
            if (artResult.rows.length === 0) {
                throw new Error('Article introuvable');
            }
            const articleName = artResult.rows[0].nom_article;

            // Check access
            const projectCheck = await client.query(
                isAdmin
                    ? 'SELECT id FROM projets WHERE id = $1'
                    : `SELECT p.id FROM projets p LEFT JOIN projet_equipe pe ON pe.projet = p.id AND pe.equipe = $2
                       WHERE p.id = $1 AND (p."Ajouté_par" = $2 OR pe.id IS NOT NULL)`,
                isAdmin ? [projectId] : [projectId, userId]
            );
            if (projectCheck.rows.length === 0) {
                throw new Error('Project not found or access denied');
            }

            const qNum = Number.isFinite(Number(quantite)) && Number(quantite) > 0 ? Number(quantite) : 1;
            const puNum = Number.isFinite(Number(finalPrixUnitaire)) && Number(finalPrixUnitaire) >= 0 ? Number(finalPrixUnitaire) : 0;
            const tvaNum = Number.isFinite(Number(tva)) && Number(tva) >= 0 ? Number(tva) : 0;
            const prixTotalHt = puNum * qNum;
            const totalTtc = prixTotalHt * (1 + tvaNum / 100);

            const DesignationHelper = require('../utils/designationHelper');

            // Calculate article designation
            let articleDesignation = null;
            if (finalBlocId && blocDesignationValue && blocDesignationValue.trim() !== '') {
                // Count articles in this bloc
                const articlesResult = await client.query(
                    `SELECT COUNT(*) as count 
                     FROM projet_article pa 
                     INNER JOIN structure s ON s.id_structure = pa.structure
                     INNER JOIN ouvrage o ON o.id = s.ouvrage
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE pl.id_projet = $1 AND s.bloc = $2 AND pa.article IS NOT NULL`,
                    [projectId, finalBlocId]
                );
                const articleIndex = parseInt(articlesResult.rows[0].count || 0) + 1;
                articleDesignation = `${blocDesignationValue}.${articleIndex}`;
            } else if (!finalBlocId && finalGblocId) {
                // Calculate designation for article directly in ouvrage
                // Get ouvrage designation
                let ouvrageDesignation = null;
                const ouvrageCheck = await client.query('SELECT designation FROM ouvrage WHERE id = $1', [finalGblocId]);
                if (ouvrageCheck.rows.length > 0 && ouvrageCheck.rows[0].designation) {
                    ouvrageDesignation = String(ouvrageCheck.rows[0].designation).trim();
                }

                if (ouvrageDesignation) {
                    const articlesResult = await client.query(
                        `SELECT COUNT(*) as count 
                         FROM projet_article pa 
                         INNER JOIN structure s ON s.id_structure = pa.structure
                         INNER JOIN ouvrage o ON o.id = s.ouvrage
                         INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                         WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND s.bloc IS NULL AND pa.article IS NOT NULL`,
                        [projectId, finalGblocId]
                    );
                    const articleIndex = parseInt(articlesResult.rows[0].count || 0) + 1;
                    articleDesignation = `${ouvrageDesignation}.${articleIndex}`;
                } else {
                    // Fallback if ouvrage has no designation
                    articleDesignation = await DesignationHelper.getNextArticleDesignation(client, projectId, finalGblocId, null);
                }
            } else {
                // Fallback
                articleDesignation = await DesignationHelper.getNextArticleDesignation(client, projectId, finalGblocId, finalBlocId);
            }

            if (!articleDesignation || articleDesignation.trim() === '') {
                articleDesignation = '1.1.1'; // Last resort
            }

            let insertedRow;
            // Try with default first, fallback to manual ID if duplicate key error
            await client.query('SAVEPOINT insert_article');

            // Check if designation_lot column exists
            const designationLotCheck = await client.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'projet_article' AND column_name = 'designation_lot'
            `);
            const hasDesignationLot = designationLotCheck.rows.length > 0;

            // Use provided designation_lot or null
            let lotDesignationToSave = designation_lot || null;

            try {
                let anchorRow = null;
                if (finalBlocId) {
                    const { rows: anchorRows } = await client.query(
                        `SELECT pa.id 
                         FROM projet_article pa 
                         INNER JOIN structure s ON s.id_structure = pa.structure
                         INNER JOIN ouvrage o ON o.id = s.ouvrage
                         INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                         WHERE pl.id_projet = $1 AND s.bloc = $2 AND pa.article IS NULL LIMIT 1`,
                        [projectId, finalBlocId]
                    );
                    anchorRow = anchorRows[0] || null;
                } else if (finalGblocId) {
                    const { rows: anchorRows } = await client.query(
                        `SELECT pa.id 
                         FROM projet_article pa 
                         INNER JOIN structure s ON s.id_structure = pa.structure
                         INNER JOIN ouvrage o ON o.id = s.ouvrage
                         INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                         WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND s.bloc IS NULL AND pa.article IS NULL LIMIT 1`,
                        [projectId, finalGblocId]
                    );
                    anchorRow = anchorRows[0] || null;
                }

                if (anchorRow && anchorRow.id) {
                    // Get the structure ID for this article
                    let structureId;
                    if (finalBlocId) {
                        // Article under bloc
                        const { rows: structureRows } = await client.query(
                            `SELECT s.id_structure 
                             FROM structure s 
                             WHERE s.ouvrage = $1 AND s.bloc = $2`,
                            [finalGblocId, finalBlocId]
                        );

                        if (structureRows.length === 0) {
                            throw new Error(`Structure not found for ouvrage ${finalGblocId} and bloc ${finalBlocId}`);
                        }

                        structureId = structureRows[0].id_structure;
                    } else {
                        // Article directly under ouvrage
                        const { rows: structureRows } = await client.query(
                            `SELECT s.id_structure 
                             FROM structure s 
                             WHERE s.ouvrage = $1 AND s.bloc IS NULL`,
                            [finalGblocId]
                        );

                        if (structureRows.length === 0) {
                            throw new Error(`Structure not found for ouvrage ${finalGblocId} with no bloc`);
                        }

                        structureId = structureRows[0].id_structure;
                    }

                    if (hasDesignationLot) {
                        const upd = await client.query(
                            `UPDATE projet_article SET 
                                article = $1, quantite = $2, prix_total_ht = $3, tva = $4, total_ttc = $5,
                                localisation = $6, description = $7, nouv_prix = $8, designation_article = $9,
                                structure = $10, designation_lot = COALESCE(designation_lot, $11)
                             WHERE id = $12 RETURNING *`,
                            [parseInt(articleId, 10), qNum, prixTotalHt, tvaNum, totalTtc,
                            localisation || null, description || null, nouv_prix, articleDesignation,
                                structureId, lotDesignationToSave, anchorRow.id]
                        );
                        insertedRow = upd.rows[0];
                    } else {
                        const upd = await client.query(
                            `UPDATE projet_article SET 
                                article = $1, quantite = $2, prix_total_ht = $3, tva = $4, total_ttc = $5,
                                localisation = $6, description = $7, nouv_prix = $8, designation_article = $9,
                                structure = $10
                             WHERE id = $11 RETURNING *`,
                            [parseInt(articleId, 10), qNum, prixTotalHt, tvaNum, totalTtc,
                            localisation || null, description || null, nouv_prix, articleDesignation,
                                structureId, anchorRow.id]
                        );
                        insertedRow = upd.rows[0];
                    }
                    await client.query('RELEASE SAVEPOINT insert_article');
                } else {
                    // Get the structure ID for this article
                    const { rows: structureRows } = await client.query(
                        `SELECT s.id_structure 
                         FROM structure s 
                         WHERE s.ouvrage = $1 AND s.bloc = $2`,
                        [finalGblocId, finalBlocId]
                    );

                    if (structureRows.length === 0) {
                        throw new Error(`Structure not found for ouvrage ${finalGblocId} and bloc ${finalBlocId}`);
                    }

                    const structureId = structureRows[0].id_structure;

                    if (hasDesignationLot) {
                        const ins = await client.query(
                            `INSERT INTO projet_article (structure, article, quantite, prix_total_ht, tva, total_ttc, localisation, description, nouv_prix, designation_article, designation_lot)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
                            [structureId, parseInt(articleId, 10), qNum, prixTotalHt, tvaNum, totalTtc, localisation || null, description || null, nouv_prix, articleDesignation, lotDesignationToSave]
                        );
                        insertedRow = ins.rows[0];
                    } else {
                        const ins = await client.query(
                            `INSERT INTO projet_article (structure, article, quantite, prix_total_ht, tva, total_ttc, localisation, description, nouv_prix, designation_article)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
                            [structureId, parseInt(articleId, 10), qNum, prixTotalHt, tvaNum, totalTtc, localisation || null, description || null, nouv_prix, articleDesignation]
                        );
                        insertedRow = ins.rows[0];
                    }
                    await client.query('RELEASE SAVEPOINT insert_article');
                }
            } catch (insertError) {
                await client.query('ROLLBACK TO SAVEPOINT insert_article');
                const maxPa = await client.query('SELECT COALESCE(MAX(id), 0) AS max_id FROM projet_article');
                const nextPa = maxPa.rows[0].max_id + 1;

                // Get the structure ID for this article
                let structureId;
                if (finalBlocId) {
                    // Article under bloc
                    const { rows: structureRows } = await client.query(
                        `SELECT s.id_structure 
                         FROM structure s 
                         WHERE s.ouvrage = $1 AND s.bloc = $2`,
                        [finalGblocId, finalBlocId]
                    );

                    if (structureRows.length === 0) {
                        throw new Error(`Structure not found for ouvrage ${finalGblocId} and bloc ${finalBlocId}`);
                    }

                    structureId = structureRows[0].id_structure;
                } else {
                    // Article directly under ouvrage
                    const { rows: structureRows } = await client.query(
                        `SELECT s.id_structure 
                         FROM structure s 
                         WHERE s.ouvrage = $1 AND s.bloc IS NULL`,
                        [finalGblocId]
                    );

                    if (structureRows.length === 0) {
                        throw new Error(`Structure not found for ouvrage ${finalGblocId} with no bloc`);
                    }

                    structureId = structureRows[0].id_structure;
                }

                if (hasDesignationLot) {
                    const ins = await client.query(
                        `INSERT INTO projet_article (id, structure, article, quantite, prix_total_ht, tva, total_ttc, localisation, description, nouv_prix, designation_article, designation_lot)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
                        [nextPa, structureId, parseInt(articleId, 10), qNum, prixTotalHt, tvaNum, totalTtc, localisation || null, description || null, nouv_prix, articleDesignation, lotDesignationToSave]
                    );
                    insertedRow = ins.rows[0];
                } else {
                    const ins = await client.query(
                        `INSERT INTO projet_article (id, structure, article, quantite, prix_total_ht, tva, total_ttc, localisation, description, nouv_prix, designation_article)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
                        [nextPa, structureId, parseInt(articleId, 10), qNum, prixTotalHt, tvaNum, totalTtc, localisation || null, description || null, nouv_prix, articleDesignation]
                    );
                    insertedRow = ins.rows[0];
                }
            }

            // Recalculate gbloc prix_total if this article belongs to a gbloc
            if (finalGblocId) {
                try {
                    await Gbloc.recalculatePrixTotal(finalGblocId, projectId, client);
                } catch (gblocError) {
                    console.error('Failed to recalculate gbloc prix_total:', gblocError);
                }
            }

            // Recompute project selling price (prix_vente) after insert (inside transaction, BEFORE event creation)
            try {
                await this.recalculatePrixVente(projectId, client);
                console.log(`✅ Recalculated prix_vente after adding article to bloc/ouvrage (articleId: ${articleId}, blocId: ${finalBlocId}, total_ttc: ${totalTtc})`);
            } catch (recalcError) {
                console.error('❌ Failed to recalculate prix_vente after adding article to bloc/ouvrage:', recalcError);
                // Don't throw - the article was added successfully
            }

            await client.query('COMMIT');

            // Create event and notifications AFTER commit (non-blocking)
            if (insertedRow) {
                setImmediate(async () => {
                    try {
                        // Get bloc name for event
                        let blocName = null;
                        if (finalBlocId) {
                            const blocResult = await pool.query('SELECT nom_bloc FROM bloc WHERE id = $1', [finalBlocId]);
                            blocName = blocResult.rows[0]?.nom_bloc;
                        }

                        // Get gbloc name if g_bloc exists
                        let gblocName = null;
                        if (finalGblocId) {
                            const ouvrageResult = await pool.query('SELECT nom_ouvrage FROM ouvrage WHERE id = $1', [finalGblocId]);
                            gblocName = ouvrageResult.rows[0]?.nom_ouvrage;
                        }

                        // Resolve lot name from ouvrage's projet_lot
                        let lotNameForEvent = null;
                        if (finalGblocId) {
                            try {
                                // Get lot ID from ouvrage's projet_lot
                                const ouv = await pool.query('SELECT projet_lot FROM ouvrage WHERE id = $1', [finalGblocId]);
                                const projetLotId = ouv.rows[0]?.projet_lot;

                                if (projetLotId) {
                                    // Get lot ID from projet_lot table
                                    const pl = await pool.query('SELECT id_lot FROM projet_lot WHERE id_projet_lot = $1', [projetLotId]);
                                    const lotId = pl.rows[0]?.id_lot;

                                    if (lotId) {
                                        // Try to get lot name - check both possible column names
                                        const lotResult = await pool.query('SELECT niveau_2, "Niveau_2__lot" FROM niveau_2 WHERE id_niveau_2 = $1', [lotId]);
                                        if (lotResult.rows[0]) {
                                            lotNameForEvent = lotResult.rows[0].niveau_2 || lotResult.rows[0].Niveau_2__lot;
                                        }
                                    }
                                }
                            } catch (e) {
                                // Silently fail
                            }
                        }

                        await EventNotificationService.articleAdded(projectId, parseInt(articleId, 10), userId, {
                            nom_article: articleName,
                            nom_bloc: blocName,
                            nom_gbloc: gblocName,
                            quantite: qNum,
                            total_ttc: totalTtc,
                            localisation,
                            lot: lotNameForEvent || lot || null,
                            bloc: finalBlocId,
                            g_bloc: finalGblocId
                        });
                    } catch (eventError) {
                        console.error('Failed to create article addition event:', eventError);
                    }
                });
            }
            return insertedRow;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Update article in a bloc
     */
    static async updateArticleInBloc(projectId, blocId, articleId, updateData, userId, isAdmin) {
        const { quantite, tva, localisation, description, prix_unitaire, nouv_prix } = updateData;

        const client = await pool.connect();
        try {
            // Check access
            const projectCheck = await client.query(
                isAdmin
                    ? 'SELECT id FROM projets WHERE id = $1'
                    : `SELECT p.id FROM projets p LEFT JOIN projet_equipe pe ON pe.projet = p.id AND pe.equipe = $2
                       WHERE p.id = $1 AND (p."Ajouté_par" = $2 OR pe.id IS NOT NULL)`,
                isAdmin ? [projectId] : [projectId, userId]
            );
            if (projectCheck.rows.length === 0) {
                throw new Error('Project not found or access denied');
            }

            // Find target row (latest one if duplicates exist)
            const targetRes = await client.query(
                `SELECT id FROM projet_article 
                 WHERE projet=$1 AND bloc=$2 AND article=$3 
                 ORDER BY id DESC LIMIT 1`,
                [projectId, blocId, articleId]
            );
            if (targetRes.rows.length === 0) {
                throw new Error('Article row not found for update');
            }
            const targetRowId = targetRes.rows[0].id;

            const values = [];
            let idx = 1;
            let setParts = [];
            if (typeof quantite === 'number') { setParts.push(`quantite = $${idx++}`); values.push(quantite); }
            if (typeof tva === 'number') { setParts.push(`tva = $${idx++}`); values.push(tva); }
            if (localisation !== undefined) { setParts.push(`localisation = $${idx++}`); values.push(localisation === '' ? '' : (localisation || null)); }
            if (description !== undefined) { setParts.push(`description = $${idx++}`); values.push(description === '' ? '' : (description || null)); }
            if (typeof nouv_prix === 'number') { setParts.push(`nouv_prix = $${idx++}`); values.push(nouv_prix); }

            // If prix_unitaire or quantite or tva or nouv_prix provided, update totals
            if (typeof prix_unitaire === 'number' || typeof quantite === 'number' || typeof tva === 'number' || typeof nouv_prix === 'number') {
                const currentRes = await client.query(
                    `SELECT quantite, tva, prix_total_ht, nouv_prix FROM projet_article WHERE id = $1`,
                    [targetRowId]
                );
                const current = currentRes.rows[0] || { quantite: 1, tva: 0, prix_total_ht: 0, nouv_prix: null };
                const currentQ = Number(current.quantite) || 1;
                const currentTva = Number(current.tva) || 0;
                const currentHt = Number(current.prix_total_ht) || 0;
                const currentNouvPrix = current.nouv_prix ? Number(current.nouv_prix) : null;

                const newQ = (typeof quantite === 'number') ? quantite : currentQ;
                const newTva = (typeof tva === 'number') ? tva : currentTva;
                const newNouvPrix = (typeof nouv_prix === 'number') ? nouv_prix : currentNouvPrix;

                const inferredPu = (currentQ > 0 && currentHt > 0) ? (currentHt / currentQ) : 0;
                let unitPu = (typeof prix_unitaire === 'number') ? prix_unitaire : inferredPu;

                // Prioritize nouv_prix if it exists
                if (newNouvPrix !== null && newNouvPrix > 0) {
                    unitPu = newNouvPrix;
                } else if (!(unitPu > 0)) {
                    try {
                        const artPuRes = await client.query(
                            `SELECT 
                                CASE 
                                    WHEN NULLIF(a."PU_Result"::text, '') IS NOT NULL THEN a."PU_Result"
                                    WHEN NULLIF(a."PU"::text, '') IS NOT NULL THEN a."PU"
                                    ELSE 0
                                END AS pu
                             FROM articles a WHERE a."ID" = $1 LIMIT 1`,
                            [articleId]
                        );
                        const fallbackPu = Number(artPuRes.rows[0]?.pu) || 0;
                        unitPu = fallbackPu;
                    } catch { }
                }

                const shouldRecomputeHt = (typeof prix_unitaire === 'number') || (typeof quantite === 'number') || (typeof nouv_prix === 'number');
                const newHt = shouldRecomputeHt ? (unitPu * newQ) : currentHt;
                const newTtc = newHt * (1 + newTva / 100);

                setParts.push(`prix_total_ht = $${idx++}`); values.push(newHt);
                setParts.push(`total_ttc = $${idx++}`); values.push(newTtc);
            }

            if (setParts.length === 0) {
                return { updated: 0 };
            }

            const sql = `UPDATE projet_article SET ${setParts.join(', ')} WHERE id = $${idx} RETURNING id, g_bloc`;
            values.push(targetRowId);
            const { rows: updRows } = await client.query(sql, values);

            // Recompute bloc pt/pu
            const { rows: tRows } = await client.query(
                `SELECT COALESCE(SUM(pa.total_ttc),0)::float AS total_ttc 
                 FROM projet_article pa
                 INNER JOIN structure s ON s.id_structure = pa.structure
                 INNER JOIN ouvrage o ON o.id = s.ouvrage
                 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 WHERE pl.id_projet = $1 AND s.bloc = $2`,
                [projectId, blocId]
            );
            const total = tRows[0]?.total_ttc || 0;
            const { rows: qb } = await client.query('SELECT quantite FROM bloc WHERE id = $1', [blocId]);
            const qbloc = Number(qb[0]?.quantite) || 0;
            const pu = qbloc > 0 ? total / qbloc : null;
            await client.query('UPDATE bloc SET pt = $1, pu = $2 WHERE id = $3', [total, pu, blocId]);

            // Recompute gbloc prix_total if applicable
            const updatedGbloc = updRows[0]?.g_bloc != null ? Number(updRows[0].g_bloc) : null;
            if (updatedGbloc) {
                await Gbloc.recalculatePrixTotal(updatedGbloc, projectId, client);
            }

            // Auto set Date_Debut and etat
            try {
                await client.query(
                    `UPDATE projets SET "Date_Debut" = COALESCE("Date_Debut", now()), etat = COALESCE(NULLIF(etat, ''), 'en cours') WHERE id = $1`,
                    [projectId]
                );
            } catch { }

            // Recompute project selling price using centralized logic
            await Project.recalculatePrixVente(projectId, client);

            return { updated: updRows.length };
        } catch (error) {
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Delete article from a bloc
     */
    static async deleteArticleFromBloc(projectId, blocId, articleId, userId, isAdmin) {
        const client = await pool.connect();
        try {
            // Check access
            const projectCheck = await client.query(
                isAdmin
                    ? 'SELECT id FROM projets WHERE id = $1'
                    : `SELECT p.id FROM projets p LEFT JOIN projet_equipe pe ON pe.projet = p.id AND pe.equipe = $2
                       WHERE p.id = $1 AND (p."Ajouté_par" = $2 OR pe.id IS NOT NULL)`,
                isAdmin ? [projectId] : [projectId, userId]
            );
            if (projectCheck.rows.length === 0) {
                throw new Error('Project not found or access denied');
            }

            // Capture related gbloc ids before delete
            const { rows: gbToUpdate } = await client.query(
                `SELECT DISTINCT s.ouvrage 
                 FROM projet_article pa
                 INNER JOIN structure s ON s.id_structure = pa.structure
                 INNER JOIN ouvrage o ON o.id = s.ouvrage
                 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 WHERE pl.id_projet = $1 AND s.bloc = $2 AND pa.article = $3 AND s.ouvrage IS NOT NULL`,
                [projectId, blocId, articleId]
            );

            // Delete the article
            const { rowCount } = await client.query(
                `DELETE FROM projet_article 
                 USING structure s, ouvrage o, projet_lot pl
                 WHERE projet_article.structure = s.id_structure 
                   AND s.ouvrage = o.id 
                   AND o.projet_lot = pl.id_projet_lot
                   AND pl.id_projet = $1 
                   AND s.bloc = $2 
                   AND projet_article.article = $3`,
                [projectId, blocId, articleId]
            );

            // Recompute bloc pt/pu
            const { rows: tRows } = await client.query(
                `SELECT COALESCE(SUM(pa.total_ttc),0)::float AS total_ttc 
                 FROM projet_article pa
                 INNER JOIN structure s ON s.id_structure = pa.structure
                 INNER JOIN ouvrage o ON o.id = s.ouvrage
                 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 WHERE pl.id_projet = $1 AND s.bloc = $2`,
                [projectId, blocId]
            );
            const total = tRows[0]?.total_ttc || 0;
            const { rows: qb } = await client.query('SELECT quantite FROM bloc WHERE id = $1', [blocId]);
            const qbloc = Number(qb[0]?.quantite) || 0;
            const pu = qbloc > 0 ? total / qbloc : null;
            await client.query('UPDATE bloc SET pt = $1, pu = $2 WHERE id = $3', [total, pu, blocId]);

            // Recompute gbloc prix_total for impacted gblocs
            for (const r of gbToUpdate) {
                const gbId = r?.g_bloc != null ? Number(r.g_bloc) : null;
                if (!gbId) continue;
                await Gbloc.recalculatePrixTotal(gbId, projectId, client);
            }

            // Recompute project selling price using centralized logic
            await Project.recalculatePrixVente(projectId, client);

            return { deleted: rowCount };
        } catch (error) {
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Delete a bloc or gbloc
     */
    static async deleteBloc(projectId, blocId, userId, isAdmin) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Access check
            const accessCheckSql = isAdmin
                ? 'SELECT id FROM projets WHERE id = $1'
                : `SELECT p.id FROM projets p LEFT JOIN projet_equipe pe ON pe.projet = p.id AND pe.equipe = $2
                   WHERE p.id = $1 AND (p."Ajouté_par" = $2 OR pe.id IS NOT NULL)`;
            const accessArgs = isAdmin ? [projectId] : [projectId, userId];
            const access = await client.query(accessCheckSql, accessArgs);
            if (access.rows.length === 0) {
                throw new Error('Project not found or access denied');
            }

            // Check if blocId is actually an ouvrage
            const ouvrageCheck = await client.query('SELECT id FROM ouvrage WHERE id = $1 LIMIT 1', [blocId]);
            if (ouvrageCheck.rows.length > 0) {
                // Delete all projet_article rows linked to this ouvrage for the project
                await client.query(
                    `DELETE FROM projet_article pa
                     USING structure s, ouvrage o, projet_lot pl
                     WHERE pa.structure = s.id_structure 
                       AND s.ouvrage = o.id 
                       AND o.projet_lot = pl.id_projet_lot
                       AND pl.id_projet = $1 
                       AND s.ouvrage = $2`,
                    [projectId, blocId]
                );
                // Delete orphan blocs that are no longer referenced
                await client.query('DELETE FROM bloc b WHERE NOT EXISTS (SELECT 1 FROM projet_article pa INNER JOIN structure s ON s.id_structure = pa.structure WHERE s.bloc = b.id)');
                // Delete the ouvrage itself
                const delOuvrage = await client.query('DELETE FROM ouvrage WHERE id = $1 RETURNING id', [blocId]);

                // Recalculate project price after deletion
                await Project.recalculatePrixVente(projectId, client);

                await client.query('COMMIT');
                return { deleted_gbloc: delOuvrage.rowCount };
            }

            // Otherwise, treat as normal bloc deletion
            // First check if this bloc is part of a lot-based structure
            const paCheck = await client.query(
                'SELECT pl.id_lot as lot, s.ouvrage as g_bloc FROM projet_article pa INNER JOIN structure s ON s.id_structure = pa.structure INNER JOIN ouvrage o ON o.id = s.ouvrage INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot WHERE pl.id_projet = $1 AND s.bloc = $2 LIMIT 1',
                [projectId, blocId]
            );

            if (paCheck.rows.length > 0 && paCheck.rows[0].lot) {
                // This is a lot-based structure
                const lotName = paCheck.rows[0].lot;
                const gBloc = paCheck.rows[0].g_bloc;

                // Check if there are other blocs in the same lot
                const otherBlocs = await client.query(
                    `SELECT b.id FROM bloc b 
                     INNER JOIN structure s ON s.bloc = b.id
                     INNER JOIN ouvrage o ON o.id = s.ouvrage
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     INNER JOIN projet_article pa ON pa.structure = s.id_structure 
                     WHERE pl.id_projet = $1 AND pl.id_lot = $2 AND s.bloc != $3`,
                    [projectId, lotName, blocId]
                );

                if (otherBlocs.rows.length > 0) {
                    // There are other blocs in this lot, only delete this bloc
                    // Keep the projet_article entry for the lot
                    await client.query('DELETE FROM bloc WHERE id = $1', [blocId]);
                    // Note: We keep the projet_article entry for the lot itself
                } else {
                    // This is the last bloc in the lot
                    // Delete the bloc but keep the lot entry with null bloc
                    await client.query('DELETE FROM bloc WHERE id = $1', [blocId]);
                    // Update the projet_article entry to set bloc to null, preserving the lot
                    await client.query(
                        `UPDATE projet_article pa
                         SET bloc = NULL
                         FROM structure s, ouvrage o, projet_lot pl
                         WHERE pa.structure = s.id_structure 
                           AND s.ouvrage = o.id 
                           AND o.projet_lot = pl.id_projet_lot
                           AND pl.id_projet = $1 
                           AND s.bloc = $2`,
                        [projectId, blocId]
                    );
                }
            } else {
                // Regular bloc deletion (not lot-based)
                await client.query(
                    `DELETE FROM projet_article pa
                     USING structure s, ouvrage o, projet_lot pl
                     WHERE pa.structure = s.id_structure 
                       AND s.ouvrage = o.id 
                       AND o.projet_lot = pl.id_projet_lot
                       AND pl.id_projet = $1 
                       AND s.bloc = $2`,
                    [projectId, blocId]
                );
                const del = await client.query('DELETE FROM bloc WHERE id = $1 RETURNING id', [blocId]);
            }
            await client.query('COMMIT');
            return { deleted: 1 };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Delete a lot (all blocs in a lot)
     */
    static async deleteLot(projectId, lotName, userId, isAdmin) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Access check
            const accessCheckSql = isAdmin
                ? 'SELECT id FROM projets WHERE id = $1'
                : `SELECT p.id FROM projets p LEFT JOIN projet_equipe pe ON pe.projet = p.id AND pe.equipe = $2
                   WHERE p.id = $1 AND (p."Ajouté_par" = $2 OR pe.id IS NOT NULL)`;
            const accessArgs = isAdmin ? [projectId] : [projectId, userId];
            const access = await client.query(accessCheckSql, accessArgs);
            if (access.rows.length === 0) {
                throw new Error('Project not found or access denied');
            }

            // Delete all articles that belong to the specified lot for this project
            await client.query(
                `DELETE FROM projet_article pa
                 USING structure s, ouvrage o, projet_lot pl
                 WHERE pa.structure = s.id_structure 
                   AND s.ouvrage = o.id 
                   AND o.projet_lot = pl.id_projet_lot
                   AND pl.id_projet = $1 
                   AND pl.id_lot = $2`,
                [projectId, lotName]
            );
            // Delete orphan blocs (with no articles)
            await client.query('DELETE FROM bloc b WHERE NOT EXISTS (SELECT 1 FROM projet_article pa INNER JOIN structure s ON s.id_structure = pa.structure WHERE s.bloc = b.id)');
            await client.query('COMMIT');
            return { deletedBlocs: true };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Update a gbloc (name) and refresh its total
     */
    static async updateGbloc(projectId, gblocId, nomGbloc, userId, isAdmin) {
        const client = await pool.connect();
        try {
            // Access check
            const accessCheckSql = isAdmin
                ? 'SELECT id FROM projets WHERE id = $1'
                : `SELECT p.id FROM projets p LEFT JOIN projet_equipe pe ON pe.projet = p.id AND pe.equipe = $2
                   WHERE p.id = $1 AND (p."Ajouté_par" = $2 OR pe.id IS NOT NULL)`;
            const accessArgs = isAdmin ? [projectId] : [projectId, userId];
            const access = await client.query(accessCheckSql, accessArgs);
            if (access.rows.length === 0) {
                throw new Error('Project not found or access denied');
            }

            // Ensure ouvrage exists
            const oRes = await client.query('SELECT id FROM ouvrage WHERE id = $1', [gblocId]);
            if (oRes.rows.length === 0) {
                throw new Error('ouvrage introuvable');
            }

            await client.query('BEGIN');

            if (typeof nomGbloc === 'string' && String(nomGbloc).trim() !== '') {
                await client.query('UPDATE ouvrage SET nom_ouvrage = $1 WHERE id = $2', [String(nomGbloc).trim(), gblocId]);
            }

            // Recompute and refresh prix_total for this gbloc within the project
            const newTotal = await Gbloc.recalculatePrixTotal(gblocId, projectId, client);

            await client.query('COMMIT');
            return {
                id: gblocId,
                nom_gbloc: (typeof nomGbloc === 'string' ? String(nomGbloc).trim() : undefined),
                prix_total: newTotal
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Update a bloc (name, unite, quantite) and recompute pu/pt
     */
    static async updateBloc(projectId, blocId, updateData, userId, isAdmin) {
        const client = await pool.connect();
        try {
            // Access check
            const accessCheckSql = isAdmin
                ? 'SELECT id FROM projets WHERE id = $1'
                : `SELECT p.id FROM projets p LEFT JOIN projet_equipe pe ON pe.projet = p.id AND pe.equipe = $2
                   WHERE p.id = $1 AND (p."Ajouté_par" = $2 OR pe.id IS NOT NULL)`;
            const accessArgs = isAdmin ? [projectId] : [projectId, userId];
            const access = await client.query(accessCheckSql, accessArgs);
            if (access.rows.length === 0) {
                throw new Error('Project not found or access denied');
            }

            const { unite = null, quantite = null, nom_bloc = undefined } = updateData || {};

            await client.query('BEGIN');

            // Update name if provided
            if (typeof nom_bloc === 'string' && String(nom_bloc).trim() !== '') {
                await client.query(`UPDATE bloc SET nom_bloc = $1 WHERE id = $2`, [String(nom_bloc).trim(), blocId]);
            }

            // Update unite and quantite
            await client.query(
                `UPDATE bloc SET unite = $1, quantite = $2 WHERE id = $3`,
                [unite, typeof quantite === 'number' ? quantite : (quantite ? parseInt(quantite, 10) : null), blocId]
            );

            // Recompute pt and pu from projet_article
            const { rows: totals } = await client.query(
                `SELECT COALESCE(SUM(pa.total_ttc), 0)::float AS total_ttc
                 FROM projet_article pa
                 INNER JOIN structure s ON s.id_structure = pa.structure
                 INNER JOIN ouvrage o ON o.id = s.ouvrage
                 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 WHERE pl.id_projet = $1 AND s.bloc = $2`,
                [projectId, blocId]
            );
            const total = totals[0]?.total_ttc || 0;
            let pu = null;
            const q = typeof quantite === 'number' ? quantite : (quantite ? parseInt(quantite, 10) : null);
            if (q && q > 0) {
                pu = total / q;
            }
            await client.query(`UPDATE bloc SET pt = $1, pu = $2 WHERE id = $3`, [total, pu, blocId]);

            await client.query('COMMIT');

            const { rows } = await client.query('SELECT id, nom_bloc, unite, quantite, pu, pt FROM bloc WHERE id = $1', [blocId]);
            return rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Duplicate an entire gbloc with all its blocs and articles
     */
    static async duplicateGbloc(projectId, sourceGblocId, nomGbloc, userId, isAdmin, userProvidedDesignation = null) {
        const client = await pool.connect();
        try {
            // Access check
            const accessCheckSql = isAdmin
                ? 'SELECT id FROM projets WHERE id = $1'
                : `SELECT p.id FROM projets p LEFT JOIN projet_equipe pe ON pe.projet = p.id AND pe.equipe = $2
                   WHERE p.id = $1 AND (p."Ajouté_par" = $2 OR pe.id IS NOT NULL)`;
            const accessArgs = isAdmin ? [projectId] : [projectId, userId];
            const access = await client.query(accessCheckSql, accessArgs);
            if (access.rows.length === 0) {
                throw new Error('Project not found or access denied');
            }

            await client.query('BEGIN');

            // Get source ouvrage (including its designation)
            const srcOuvrage = await client.query('SELECT id, nom_ouvrage, prix_total, designation FROM ouvrage WHERE id = $1', [sourceGblocId]);
            if (srcOuvrage.rows.length === 0) {
                throw new Error('ouvrage introuvable');
            }

            // Use user-provided designation if available, otherwise calculate from source
            let newOuvrageDesignation = null;
            if (userProvidedDesignation && String(userProvidedDesignation).trim()) {
                newOuvrageDesignation = String(userProvidedDesignation).trim();
            } else {
                // Get source designation and increment the last number
                const sourceDesignation = srcOuvrage.rows[0].designation;

                if (sourceDesignation && String(sourceDesignation).trim()) {
                    // Increment the last number in the designation
                    // Example: "1.2" -> "1.3", "2.3.3" -> "2.3.4"
                    const parts = String(sourceDesignation).trim().split('.');
                    if (parts.length > 0 && parts[0]) {
                        const lastPart = parts[parts.length - 1];
                        const lastNumber = parseInt(lastPart, 10);
                        if (!isNaN(lastNumber) && lastNumber > 0) {
                            parts[parts.length - 1] = String(lastNumber + 1);
                            newOuvrageDesignation = parts.join('.');
                        } else {
                            // If last part is not a number, append ".1"
                            newOuvrageDesignation = sourceDesignation + '.1';
                        }
                    } else {
                        // If designation is empty or invalid, calculate a new one
                        const DesignationHelper = require('../utils/designationHelper');
                        let lotIdForDesignation = null;
                        // Get lot ID from projet_article if available
                        const lotCheck = await client.query(
                            `SELECT DISTINCT pl.id_lot AS lot
                             FROM projet_article pa
                             INNER JOIN structure s ON s.id_structure = pa.structure
                             INNER JOIN ouvrage o ON o.id = s.ouvrage
                             INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                             WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND pl.id_lot IS NOT NULL 
                             LIMIT 1`,
                            [projectId, sourceGblocId]
                        );
                        if (lotCheck.rows.length > 0) {
                            lotIdForDesignation = lotCheck.rows[0].lot;
                        }
                        newOuvrageDesignation = await DesignationHelper.getNextOuvrageDesignation(client, projectId, lotIdForDesignation);
                    }
                } else {
                    // Source has no designation - calculate a new one
                    const DesignationHelper = require('../utils/designationHelper');
                    let lotIdForDesignation = null;
                    // Get lot ID from projet_article if available
                    const lotCheck = await client.query(
                        `SELECT DISTINCT pl.id_lot AS lot
                     FROM projet_article pa
                     INNER JOIN structure s ON s.id_structure = pa.structure
                     INNER JOIN ouvrage o ON o.id = s.ouvrage
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND pl.id_lot IS NOT NULL 
                     LIMIT 1`,
                        [projectId, sourceGblocId]
                    );
                    if (lotCheck.rows.length > 0) {
                        lotIdForDesignation = lotCheck.rows[0].lot;
                    }
                    newOuvrageDesignation = await DesignationHelper.getNextOuvrageDesignation(client, projectId, lotIdForDesignation);
                }
            }

            // Determine projet_lot to use for the new ouvrage
            const lotCheckForProjetLot = await client.query(
                `SELECT pl.id_lot 
                 FROM ouvrage o
                 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 WHERE pl.id_projet = $1 AND o.id = $2
                 LIMIT 1`,
                [projectId, sourceGblocId]
            );
            const sourceLotIdForProjetLot = lotCheckForProjetLot.rows.length > 0 ? lotCheckForProjetLot.rows[0].id_lot : null;
            let projetLotIdForNewOuvrage;
            if (sourceLotIdForProjetLot) {
                const existingPl = await client.query(
                    `SELECT id_projet_lot FROM projet_lot WHERE id_projet = $1 AND id_lot = $2`,
                    [projectId, sourceLotIdForProjetLot]
                );
                if (existingPl.rows.length === 0) {
                    // Calculate sequential lot number for this project
                    const lotCountResult = await client.query(
                        'SELECT COUNT(*) as count FROM projet_lot WHERE id_projet = $1',
                        [projectId]
                    );
                    const nextLotNumber = parseInt(lotCountResult.rows[0].count || 0) + 1;
                    const designationLot = `Lot ${nextLotNumber}:`;
                    const seqCheck = await client.query("SELECT to_regclass('projet_lot_id_projet_lot_seq') as seq");
                    let nextIdPl;
                    if (seqCheck.rows[0]?.seq) {
                        const sequenceResult = await client.query("SELECT nextval('projet_lot_id_projet_lot_seq')");
                        nextIdPl = sequenceResult.rows[0].nextval;
                    } else {
                        const maxIdResult = await client.query('SELECT COALESCE(MAX(id_projet_lot), 0) + 1 as next_id FROM projet_lot');
                        nextIdPl = maxIdResult.rows[0].next_id;
                    }
                    const newPl = await client.query(
                        `INSERT INTO projet_lot (id_projet_lot, id_projet, id_lot, designation_lot) VALUES ($1, $2, $3, $4) RETURNING id_projet_lot`,
                        [nextIdPl, projectId, sourceLotIdForProjetLot, designationLot]
                    );
                    projetLotIdForNewOuvrage = newPl.rows[0].id_projet_lot;
                } else {
                    projetLotIdForNewOuvrage = existingPl.rows[0].id_projet_lot;
                }
            } else {
                const plNullResPre = await client.query(
                    `SELECT id_projet_lot FROM projet_lot WHERE id_projet = $1 AND id_lot IS NULL`,
                    [projectId]
                );
                if (plNullResPre.rows.length === 0) {
                    const seqCheck = await client.query("SELECT to_regclass('projet_lot_id_projet_lot_seq') as seq");
                    let nextIdPl;
                    if (seqCheck.rows[0]?.seq) {
                        const sequenceResult = await client.query("SELECT nextval('projet_lot_id_projet_lot_seq')");
                        nextIdPl = sequenceResult.rows[0].nextval;
                    } else {
                        const maxIdResult = await client.query('SELECT COALESCE(MAX(id_projet_lot), 0) + 1 as next_id FROM projet_lot');
                        nextIdPl = maxIdResult.rows[0].next_id;
                    }
                    const newProjetLot = await client.query(
                        `INSERT INTO projet_lot (id_projet_lot, id_projet, id_lot, designation_lot) VALUES ($1, $2, NULL, $3) RETURNING id_projet_lot`,
                        [nextIdPl, projectId, 'Sans lot']
                    );
                    projetLotIdForNewOuvrage = newProjetLot.rows[0].id_projet_lot;
                } else {
                    projetLotIdForNewOuvrage = plNullResPre.rows[0].id_projet_lot;
                }
            }

            // Create new ouvrage with incremented designation and proper projet_lot
            const ouvrageIdCheck = await client.query(`SELECT column_default FROM information_schema.columns WHERE table_name = 'ouvrage' AND column_name = 'id'`);
            const { getNextAvailableOuvrageId } = require('../utils/idConflictResolver');

            // First, find all blocs that will be duplicated to predict needed bloc IDs
            const { rows: blocsToDuplicate } = await client.query(
                `SELECT DISTINCT b.id AS bloc_id
                 FROM structure s 
                 INNER JOIN ouvrage o ON o.id = s.ouvrage
                 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 INNER JOIN bloc b ON b.id = s.bloc
                 WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND s.bloc IS NOT NULL`,
                [projectId, sourceGblocId]
            );
            const blocCount = blocsToDuplicate.length;

            let newGblocId;
            if (ouvrageIdCheck.rows[0]?.column_default) {
                // For auto-increment: we need to ensure the ouvrage ID is high enough to avoid conflicts with blocs
                // Get the current max bloc ID and add the number of blocs we'll create plus 1
                const maxBlocRes = await client.query('SELECT COALESCE(MAX(id), 0) AS max_id FROM bloc');
                const minSafeOuvrageId = maxBlocRes.rows[0].max_id + blocCount + 1;

                // Create the ouvrage - auto-increment will assign the next available ID
                const ins = await client.query(
                    'INSERT INTO ouvrage (nom_ouvrage, prix_total, designation, projet_lot) VALUES ($1, $2, $3, $4) RETURNING id',
                    [String(nomGbloc).trim(), Number(srcOuvrage.rows[0].prix_total ?? 0), newOuvrageDesignation, projetLotIdForNewOuvrage]
                );
                newGblocId = ins.rows[0].id;

                // ✅ Post-creation conflict check: Ensure ouvrage ID doesn't conflict with any bloc ID
                const safeOuvrageId = await getNextAvailableOuvrageId(newGblocId);
                if (safeOuvrageId !== newGblocId) {
                    console.warn(`⚠️ Post-creation conflict detected: ouvrage.id (${newGblocId}) conflicts with existing bloc IDs`);

                    // Update ouvrage with the safe ID
                    await client.query(
                        'UPDATE ouvrage SET id = $1 WHERE id = $2',
                        [safeOuvrageId, newGblocId]
                    );

                    // Update structure table references to use the new ouvrage ID
                    await client.query(
                        'UPDATE structure SET ouvrage = $1 WHERE ouvrage = $2',
                        [safeOuvrageId, newGblocId]
                    );

                    console.log(`✅ Ouvrage ID changed: ${newGblocId} → ${safeOuvrageId} to avoid conflict with existing bloc IDs`);
                    newGblocId = safeOuvrageId;
                }

                // 🔄 Additional check: Ensure ouvrage ID is high enough for future blocs
                if (newGblocId < minSafeOuvrageId) {
                    console.warn(`⚠️ Ouvrage ID ${newGblocId} is too low for ${blocCount} blocs. Need at least ${minSafeOuvrageId}`);

                    // Find the next safe ouvrage ID that's high enough
                    const nextSafeOuvrageId = await getNextAvailableOuvrageId(minSafeOuvrageId);

                    // Update ouvrage with the safe ID
                    await client.query(
                        'UPDATE ouvrage SET id = $1 WHERE id = $2',
                        [nextSafeOuvrageId, newGblocId]
                    );

                    // Update structure table references to use the new ouvrage ID
                    await client.query(
                        'UPDATE structure SET ouvrage = $1 WHERE ouvrage = $2',
                        [nextSafeOuvrageId, newGblocId]
                    );

                    console.log(`✅ Ouvrage ID changed: ${newGblocId} → ${nextSafeOuvrageId} to reserve space for ${blocCount} blocs`);
                    newGblocId = nextSafeOuvrageId;
                }
            } else {
                // For manual IDs: ensure we start high enough to avoid conflicts
                const maxRes = await client.query('SELECT COALESCE(MAX(id), 0) AS max_id FROM ouvrage');
                const maxBlocRes = await client.query('SELECT COALESCE(MAX(id), 0) AS max_id FROM bloc');

                // Start at least blocCount+1 positions above the max bloc ID
                let nextId = Math.max(maxRes.rows[0].max_id + 1, maxBlocRes.rows[0].max_id + blocCount + 1);

                // Check for conflicts and get next available ID
                nextId = await getNextAvailableOuvrageId(nextId);
                await client.query(
                    'INSERT INTO ouvrage (id, nom_ouvrage, prix_total, designation, projet_lot) VALUES ($1, $2, $3, $4, $5)',
                    [nextId, String(nomGbloc).trim(), Number(srcOuvrage.rows[0].prix_total ?? 0), newOuvrageDesignation, projetLotIdForNewOuvrage]
                );
                newGblocId = nextId;
            }

            // Find all distinct blocs under this gbloc (including empty blocs)
            const { rows: srcBlocs } = await client.query(
                `SELECT DISTINCT b.id AS bloc_id, b.nom_bloc, b.unite, b.quantite, b.pu, b.pt, b.designation
                 FROM structure s 
                 INNER JOIN ouvrage o ON o.id = s.ouvrage
                 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 INNER JOIN bloc b ON b.id = s.bloc
                 WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND s.bloc IS NOT NULL ORDER BY b.id`,
                [projectId, sourceGblocId]
            );

            // Create new blocs and map old to new IDs
            const blocIdMap = new Map();
            const blocIdCheck = await client.query(`SELECT column_default FROM information_schema.columns WHERE table_name = 'bloc' AND column_name = 'id'`);
            const { getNextAvailableBlocId } = require('../utils/idConflictResolver');

            // 🔒 CRITICAL FIX: Pre-allocate safe bloc ID range to prevent conflicts with newGblocId
            // Calculate the minimum safe starting ID for blocs (must be > newGblocId)
            const minSafeBlocId = newGblocId + 1;
            let nextAvailableBlocId = await getNextAvailableBlocId(minSafeBlocId);
            console.log(`[DUPLICATE] Reserved bloc ID range starting from ${nextAvailableBlocId} (ouvrage ID is ${newGblocId})`);

            for (const sb of srcBlocs) {
                let newBlocId;
                if (blocIdCheck.rows[0]?.column_default) {
                    // 🔒 CRITICAL FIX: Use pre-allocated ID instead of auto-increment to avoid conflicts
                    newBlocId = nextAvailableBlocId++;

                    const insB = await client.query(
                        'INSERT INTO bloc (id, nom_bloc, unite, quantite, pu, pt, designation, ouvrage) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
                        [newBlocId, sb.nom_bloc, sb.unite ?? null, sb.quantite ?? null, sb.pu ?? null, sb.pt ?? null, sb.designation ?? null, newGblocId]
                    );

                    console.log(`[DUPLICATE] Created bloc ${newBlocId} for ouvrage ${newGblocId}`);
                } else {
                    // Manual ID mode: use the safe range
                    newBlocId = nextAvailableBlocId++;
                    await client.query(
                        'INSERT INTO bloc (id, nom_bloc, unite, quantite, pu, pt, designation, ouvrage) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                        [newBlocId, sb.nom_bloc, sb.unite ?? null, sb.quantite ?? null, sb.pu ?? null, sb.pt ?? null, sb.designation ?? null, newGblocId]
                    );
                    console.log(`[DUPLICATE] Created bloc ${newBlocId} (manual) for ouvrage ${newGblocId}`);
                }
                blocIdMap.set(sb.bloc_id, newBlocId);
            }

            // Check if designation_lot column exists
            const designationLotCheck = await client.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'projet_article' AND column_name = 'designation_lot'
            `);
            const hasDesignationLot = designationLotCheck.rows.length > 0;

            const paIdCheck = await client.query(`SELECT column_default FROM information_schema.columns WHERE table_name = 'projet_article' AND column_name = 'id'`);


            // projet_lot already set on insert

            // ✅ FIX: Create structure entries using Structure.findOrCreate to ensure action field is set
            const Structure = require('./Structure');

            // Create structure for new ouvrage (action = 'ouvrage')
            await Structure.findOrCreate(newGblocId, null, client);

            // Create structure entries for each new bloc (action = 'bloc')
            for (const newBlocId of blocIdMap.values()) {
                await Structure.findOrCreate(newGblocId, newBlocId, client);
            }

            // ✅ ORGANIZED HIERARCHY: Step 4 - Copy only article rows (rows with article IS NOT NULL)
            let selectFields = 'pa.article, pa.quantite, pa.prix_total_ht, pa.tva, pa.total_ttc, pa.localisation, pa.description, s.bloc, pl.id_lot';
            if (hasDesignationLot) {
                selectFields += ', pa.designation_lot';
            }
            const { rows: rowsToCopy } = await client.query(
                `SELECT ${selectFields}
                 FROM projet_article pa
                 INNER JOIN structure s ON s.id_structure = pa.structure
                 INNER JOIN ouvrage o ON o.id = s.ouvrage
                 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND pa.article IS NOT NULL 
                 ORDER BY pa.id`,
                [projectId, sourceGblocId]
            );

            // Get the structure ID for the new ouvrage (without bloc)
            const newOuvrageStructure = await client.query(
                'SELECT id_structure FROM structure WHERE ouvrage = $1 AND bloc IS NULL',
                [newGblocId]
            );
            const newOuvrageStructureId = newOuvrageStructure.rows[0]?.id_structure;

            for (const r of rowsToCopy) {
                // For articles with bloc, map to new bloc ID; for articles with null bloc, keep null
                const newBlocId = r.bloc ? blocIdMap.get(r.bloc) : null;
                // Skip if article has a bloc that wasn't mapped (shouldn't happen, but safety check)
                if (r.bloc && !newBlocId) continue;

                // Get the structure ID for this article (either bloc structure or ouvrage structure)
                let newStructureId;
                if (newBlocId) {
                    // Get structure for this ouvrage + bloc combination
                    const blocStructure = await client.query(
                        'SELECT id_structure FROM structure WHERE ouvrage = $1 AND bloc = $2',
                        [newGblocId, newBlocId]
                    );
                    newStructureId = blocStructure.rows[0]?.id_structure;
                } else {
                    // Use the ouvrage structure (no bloc)
                    newStructureId = newOuvrageStructureId;
                }

                if (!newStructureId) {
                    console.error('Could not find structure for article copy');
                    continue;
                }

                // Preserve designation_lot from source if it exists
                const designationLot = hasDesignationLot ? (r.designation_lot || null) : null;

                // Insert using structure ID instead of bloc/ouvrage/lot columns
                if (paIdCheck.rows[0]?.column_default) {
                    if (hasDesignationLot) {
                        await client.query(
                            `INSERT INTO projet_article (structure, article, quantite, prix_total_ht, tva, total_ttc, localisation, description, designation_article, designation_lot)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                            [newStructureId, r.article, r.quantite, r.prix_total_ht, r.tva, r.total_ttc, r.localisation, r.description, null, designationLot]
                        );
                    } else {
                        await client.query(
                            `INSERT INTO projet_article (structure, article, quantite, prix_total_ht, tva, total_ttc, localisation, description, designation_article)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                            [newStructureId, r.article, r.quantite, r.prix_total_ht, r.tva, r.total_ttc, r.localisation, r.description, null]
                        );
                    }
                } else {
                    const maxA = await client.query('SELECT COALESCE(MAX(id), 0) AS max_id FROM projet_article');
                    const nextA = maxA.rows[0].max_id + 1;
                    if (hasDesignationLot) {
                        await client.query(
                            `INSERT INTO projet_article (id, structure, article, quantite, prix_total_ht, tva, total_ttc, localisation, description, designation_article, designation_lot)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                            [nextA, newStructureId, r.article, r.quantite, r.prix_total_ht, r.tva, r.total_ttc, r.localisation, r.description, null, designationLot]
                        );
                    } else {
                        await client.query(
                            `INSERT INTO projet_article (id, structure, article, quantite, prix_total_ht, tva, total_ttc, localisation, description, designation_article)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                            [nextA, newStructureId, r.article, r.quantite, r.prix_total_ht, r.tva, r.total_ttc, r.localisation, r.description, null]
                        );
                    }
                }
            }

            // Recompute pt/pu for each new bloc
            for (const newBlocId of blocIdMap.values()) {
                const totals = await client.query(
                    `SELECT COALESCE(SUM(pa.total_ttc),0)::float AS total_ttc
                     FROM projet_article pa
                     INNER JOIN structure s ON s.id_structure = pa.structure
                     INNER JOIN ouvrage o ON o.id = s.ouvrage
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE pl.id_projet = $1 AND s.bloc = $2`,
                    [projectId, newBlocId]
                );
                const total = totals.rows[0]?.total_ttc || 0;
                const qres = await client.query('SELECT quantite FROM bloc WHERE id = $1', [newBlocId]);
                const qbloc = Number(qres.rows[0]?.quantite) || 0;
                const puVal = qbloc > 0 ? total / qbloc : null;
                await client.query('UPDATE bloc SET pt = $1, pu = $2 WHERE id = $3', [total, puVal, newBlocId]);
            }

            // Recalculate designations for blocs and articles under this new ouvrage
            // IMPORTANT: Don't recalculate the ouvrage designation - we already set it correctly above
            // Only recalculate blocs and articles, preserving the ouvrage designation we set
            const DesignationHelper = require('../utils/designationHelper');
            let lotIdForDesignation = null;
            if (rowsToCopy.length > 0 && rowsToCopy[0].id_lot) {
                lotIdForDesignation = rowsToCopy[0].id_lot;
            }

            // Recalculate designations starting from the new ouvrage designation
            // Pass the new ouvrage ID and designation to ensure it's preserved
            // The function should preserve the designation for the target ouvrage
            await DesignationHelper.recalculateProjectDesignations(projectId, client, newOuvrageDesignation, newGblocId, lotIdForDesignation);

            // Double-check: Ensure the new ouvrage still has the correct incremented designation
            // This prevents the recalculation from overwriting it
            await client.query('UPDATE ouvrage SET designation = $1 WHERE id = $2', [newOuvrageDesignation, newGblocId]);

            // CRITICAL: After recalculation, explicitly recalculate article designations for each new bloc
            // This ensures articles get fresh designations based on their new bloc IDs, not copied from source
            // Process articles grouped by bloc to ensure sequential numbering within each bloc
            for (const newBlocId of blocIdMap.values()) {
                // Get all articles in this new bloc, ordered by their insertion order (id)
                const articlesInBloc = await client.query(
                    `SELECT pa.id, pa.designation_article 
                     FROM projet_article pa
                     INNER JOIN structure s ON s.id_structure = pa.structure
                     INNER JOIN ouvrage o ON o.id = s.ouvrage
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE pl.id_projet = $1 AND s.bloc = $2 AND pa.article IS NOT NULL 
                     ORDER BY pa.id ASC`,
                    [projectId, newBlocId]
                );

                // Get the bloc's current designation (should have been set by recalculateProjectDesignations)
                const blocResult = await client.query('SELECT designation FROM bloc WHERE id = $1', [newBlocId]);
                const blocDesignation = blocResult.rows[0]?.designation;

                if (blocDesignation && String(blocDesignation).trim() !== '') {
                    // Recalculate designation for each article sequentially based on the new bloc's designation
                    // Article index starts at 1 and increments for each article
                    for (let i = 0; i < articlesInBloc.rows.length; i++) {
                        const article = articlesInBloc.rows[i];
                        const articleIndex = i + 1;
                        const newArticleDesignation = `${blocDesignation}.${articleIndex}`;

                        // Update the article designation
                        await client.query(
                            'UPDATE projet_article SET designation_article = $1 WHERE id = $2',
                            [newArticleDesignation, article.id]
                        );
                    }
                }
            }

            // Also recalculate designations for articles directly in ouvrage (bloc IS NULL)
            const ouvrageArticles = await client.query(
                `SELECT pa.id, pa.designation_article 
                 FROM projet_article pa
                 INNER JOIN structure s ON s.id_structure = pa.structure
                 INNER JOIN ouvrage o ON o.id = s.ouvrage
                 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 WHERE pl.id_projet = $1 AND s.ouvrage = $2 AND s.bloc IS NULL AND pa.article IS NOT NULL 
                 ORDER BY pa.id ASC`,
                [projectId, newGblocId]
            );

            // Get ouvrage designation (should already be set)
            const ouvrageResult = await client.query('SELECT designation FROM ouvrage WHERE id = $1', [newGblocId]);
            const ouvrageDesignation = ouvrageResult.rows[0]?.designation || newOuvrageDesignation;

            // Recalculate designation for each ouvrage-level article sequentially
            for (let i = 0; i < ouvrageArticles.rows.length; i++) {
                const article = ouvrageArticles.rows[i];
                const articleIndex = i + 1;
                const newArticleDesignation = `${ouvrageDesignation}.${articleIndex}`;

                await client.query(
                    'UPDATE projet_article SET designation_article = $1 WHERE id = $2',
                    [newArticleDesignation, article.id]
                );
            }

            // Recalculate the new ouvrage/gbloc total price based on the actual copied articles
            // This ensures the ouvrage.prix_total completely matches the sum of its contents
            await Gbloc.recalculatePrixTotal(newGblocId, projectId, client);

            await client.query('COMMIT');

            // Get lot information for event
            let lotName = null;
            if (rowsToCopy.length > 0) {
                lotName = rowsToCopy[0].id_lot || null;
            }

            // Emit gbloc duplicated event asynchronously
            setImmediate(() => {
                try {
                    EventNotificationService.gblocDuplicated(
                        projectId,
                        sourceGblocId,
                        newGblocId,
                        userId,
                        srcOuvrage.rows[0]?.nom_ouvrage || null,
                        String(nomGbloc).trim(),
                        lotName
                    );
                } catch (eventError) {
                    console.error('❌ Failed to create gbloc duplicated event:', eventError);
                }
            });

            return { id: newGblocId, nom_gbloc: String(nomGbloc).trim(), blocs: blocIdMap.size };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    // Bloc duplication removed - only ouvrage duplication is allowed
    // Lot duplication removed - only ouvrage duplication is allowed

    /**
     * Get all articles for a project with pagination
     */
    static async getProjectArticles(projectId, { page = 1, limit = 10, userId, isAdmin }) {
        const client = await pool.connect();
        try {
            // Check access
            const accessCheckSql = isAdmin
                ? 'SELECT id FROM projets WHERE id = $1'
                : `SELECT p.id FROM projets p LEFT JOIN projet_equipe pe ON pe.projet = p.id AND pe.equipe = $2
                   WHERE p.id = $1 AND (p."Ajouté_par" = $2 OR pe.id IS NOT NULL)`;
            const accessArgs = isAdmin ? [projectId] : [projectId, userId];
            const access = await client.query(accessCheckSql, accessArgs);
            if (access.rows.length === 0) {
                throw new Error('Project not found or access denied');
            }

            const offset = (page - 1) * limit;

            // Get total count
            const countResult = await client.query(
                `SELECT COUNT(*) as total
                 FROM projet_article pa
                 INNER JOIN structure s ON s.id_structure = pa.structure
                 INNER JOIN ouvrage o ON o.id = s.ouvrage
                 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 WHERE pl.id_projet = $1 AND pa.article IS NOT NULL`,
                [projectId]
            );
            const total = parseInt(countResult.rows[0].total, 10);

            // Get paginated articles
            const { rows } = await client.query(
                `SELECT pa.id, pl.id_projet as projet, pa.article, pa.quantite, pa.prix_total_ht, pa.tva, pa.total_ttc,
                        pa.localisation, pa.description, pl.id_lot as lot, s.ouvrage as g_bloc, s.bloc,
                        COALESCE(pa.designation_article, a."nom_article") AS nom_article,
                        a."Unite" AS unite,
                        a."Date" AS date_article,
                        b.nom_bloc as bloc_nom
                 FROM projet_article pa
                 INNER JOIN structure s ON s.id_structure = pa.structure
                 INNER JOIN ouvrage o ON o.id = s.ouvrage
                 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 LEFT JOIN articles a ON a."ID" = pa.article
                 LEFT JOIN bloc b ON b.id = s.bloc
                 WHERE pl.id_projet = $1 AND pa.article IS NOT NULL
                 ORDER BY pa.id DESC
                 LIMIT $2 OFFSET $3`,
                [projectId, limit, offset]
            );

            return {
                data: rows,
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            };
        } finally {
            client.release();
        }
    }
}

module.exports = Project;
