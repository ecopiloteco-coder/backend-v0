const Project = require('../models/Project');
const Article = require('../models/Article');
const Bloc = require('../models/Bloc');
const Gbloc = require('../models/Gbloc');
const Lot = require('../models/Lot');
const pool = require('../../config/db');

// Import the shared event emitter from eventBus
const { projectEvents } = require('../utils/eventBus');
const { cache } = require('../utils/cache');
const { validateOuvrageData, validateBlocData } = require('../utils/validationHelper');

// Helper to broadcast project change for real-time updates
function broadcastProjectChange(projectId, type, payload = {}) {
    try {
        projectEvents.emit('projectChanged', { projectId, type, ...payload, timestamp: Date.now() });
    } catch (e) {
        console.error('Failed to broadcast project change:', e);
    }
}

/**
 * Get all projects with pagination and search
 */
exports.getAllProjects = async (req, res) => {
    try {
        const { q: search = '', page = 1, limit = 10, scope } = req.query;
        const userId = req.user?.id;
        let isAdmin = (req.user?.is_admin === true) || (req.user?.is_admin === 'true') || (req.user?.role === 'admin');

        // For user-facing "Mes projets" view, allow forcing a team-scoped list
        // even if the authenticated user has admin privileges.
        if (scope === 'team') {
            isAdmin = false;
        }

        const cacheKey = ['projects:list', search, parseInt(page, 10), parseInt(limit, 10), userId || 0, !!isAdmin];
        const cached = cache.get(cacheKey);
        if (cached) {
            return res.json({ success: true, data: cached });
        }
        const projects = await Project.findAll({
            search,
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            userId,
            isAdmin
        });
        cache.set(cacheKey, projects);
        return res.json({ success: true, data: projects });
    } catch (error) {
        console.error('Error fetching projects:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Get project by ID
 */
exports.getProjectById = async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        if (isNaN(projectId)) {
            return res.status(400).json({ success: false, message: 'Invalid project ID' });
        }

        const userId = req.user?.id;
        const isAdmin = (req.user?.is_admin === true) || (req.user?.is_admin === 'true') || (req.user?.role === 'admin');

        // Check access
        const hasAccess = await Project.checkUserAccess(projectId, userId, isAdmin);
        if (!hasAccess) {
            return res.status(404).json({
                success: false,
                message: 'Project not found or you do not have permission to view it'
            });
        }

        const cacheKey = ['projects:item', projectId];
        const cached = cache.get(cacheKey);
        const project = cached || await Project.findById(projectId);
        if (!project) {
            return res.status(404).json({ success: false, message: 'Project not found' });
        }

        // Get team members
        const team = await Project.getTeamMembers(projectId);
        project.team = team;

        cache.set(cacheKey, project);
        return res.json({ success: true, data: project });
    } catch (error) {
        console.error('Error fetching project:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Get project price only (Optimized for polling)
 */
exports.getProjectPrice = async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        if (isNaN(projectId)) {
            return res.status(400).json({ success: false, message: 'Invalid project ID' });
        }

        const userId = req.user?.id;
        const isAdmin = (req.user?.is_admin === true) || (req.user?.is_admin === 'true') || (req.user?.role === 'admin');

        // Check access (lightweight check)
        const hasAccess = await Project.checkUserAccess(projectId, userId, isAdmin);
        if (!hasAccess) {
            return res.status(404).json({
                success: false,
                message: 'Project not found or access denied'
            });
        }

        const client = await pool.connect();
        try {
            const result = await client.query('SELECT prix_vente, "Cout" FROM projets WHERE id = $1', [projectId]);
            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Project not found' });
            }
            return res.json({
                success: true,
                data: {
                    prix_vente: result.rows[0].prix_vente,
                    cout: result.rows[0].Cout
                }
            });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error fetching project price:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Create a new project
 */
exports.createProject = async (req, res) => {
    try {
        const {
            nom_projet,
            date_limite,
            date_debut,
            description,
            file,
            adresse,
            cout,
            etat,
            teamUserIds,
            clientId: providedClientId,
            client_nom,
            client_marge_brut,
            client_marge_net,
        } = req.body;

        if (!nom_projet || !nom_projet.trim()) {
            return res.status(400).json({ success: false, message: 'Project name is required' });
        }

        const client = await pool.connect();
        await client.query('BEGIN');

        console.log('Project creation request:', {
            nom_projet,
            clientId: providedClientId,
            client_nom,
            client_marge_brut,
            client_marge_net,
            teamUserIds: teamUserIds?.length || 0
        });

        const userId = req.user.id;



        // Handle client ID - use existing clientId if provided, otherwise create new client
        let clientId = providedClientId || null;

        // Only create a new client if no clientId was provided but client data exists
        if (!clientId && (client_nom || client_marge_brut !== undefined || client_marge_net !== undefined)) {
            console.log('Creating new client with data:', { client_nom, client_marge_brut, client_marge_net });
            try {
                const Client = require('../models/Client');
                const newClient = await Client.create({
                    nom_client: client_nom || 'Nouveau Client',
                    marge_brut: client_marge_brut || null,
                    marge_net: client_marge_net || null
                });
                clientId = newClient.id;
                console.log('Created client with ID:', clientId);
            } catch (clientError) {
                console.error('Error creating client:', clientError);
                console.error('Client creation failed, continuing without client');
                // If client creation fails, continue without client
                clientId = null;
            }
        } else {
            console.log('Using existing client ID:', clientId);
        }

        // Create project
        const projectId = await Project.create({
            nom_projet,
            date_limite,
            date_debut,
            description,
            file,
            adresse,
            cout,
            etat: etat || 'en attente',
            userId,
            clientId
        }, client);

        // Add team members
        if (Array.isArray(teamUserIds) && teamUserIds.length > 0) {
            await Project.updateTeam(projectId, teamUserIds, userId, client);
        }

        await client.query('COMMIT');
        cache.clear();
        return res.json({ success: true, data: { id: projectId } });
    } catch (error) {
        console.error('Error creating project:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Update project
 */
exports.updateProject = async (req, res) => {
    const client = await pool.connect();

    try {
        const projectId = parseInt(req.params.id, 10);
        if (isNaN(projectId)) {
            return res.status(400).json({ success: false, message: 'Invalid project ID' });
        }

        const userId = req.user.id;
        const isAdmin = !!req.user.is_admin;

        await client.query('BEGIN');

        // Check access
        const projectCheck = await client.query(
            isAdmin
                ? 'SELECT id FROM projets WHERE id = $1'
                : 'SELECT id FROM projets WHERE id = $1 AND "Ajouté_par" = $2',
            isAdmin ? [projectId] : [projectId, userId]
        );

        if (projectCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                message: 'Project not found or you do not have permission to update it'
            });
        }

        const {
            nom_projet,
            date_limite,
            date_debut,
            description,
            file,
            adresse,
            cout,
            etat,
            teamUserIds,
            articleIds,
            client_nom,
            client_marge_brut,
            client_marge_net,
        } = req.body;

        // Update project basic info (suppress per-step event)
        const isUserAction = !isAdmin; // If not admin, it's a user action
        const fieldResult = await Project.update(projectId, {
            nom_projet,
            date_limite,
            date_debut,
            description,
            file,
            adresse,
            cout,
            etat
        }, userId, isUserAction, client, { suppressEvent: true });

        // Update client if provided and capture diff for event consolidation
        let clientChanges = null;
        if (client_nom !== undefined || client_marge_brut !== undefined || client_marge_net !== undefined) {
            const clientResult = await Project.upsertClient(projectId, {
                client_nom,
                client_marge_brut,
                client_marge_net
            }, client);
            if (clientResult && clientResult.changes && Object.keys(clientResult.changes).length > 0) {
                clientChanges = clientResult.changes;
            }
        }

        // Update team members only if explicitly provided (suppress per-step event)
        let teamDiff = null;
        if (typeof teamUserIds !== 'undefined' && Array.isArray(teamUserIds)) {
            teamDiff = await Project.updateTeam(projectId, teamUserIds, userId, client, { suppressEvent: true });
        }

        // Update articles only if explicitly provided
        if (typeof articleIds !== 'undefined' && Array.isArray(articleIds)) {
            await client.query('DELETE FROM projet_article WHERE projet = $1', [projectId]);
            if (articleIds.length > 0) {
                const maxArticleIdResult = await client.query('SELECT COALESCE(MAX("id"), 0) as max_id FROM projet_article');
                let nextArticleId = maxArticleIdResult.rows[0].max_id + 1;
                for (const articleId of articleIds) {
                    await client.query(
                        `INSERT INTO projet_article ("id", projet, article) VALUES ($1, $2, $3)`,
                        [nextArticleId++, projectId, articleId]
                    );
                }
            }
            // Recalculate prix_vente inside transaction context
            try {
                const Project = require('../models/Project');
                await Project.recalculatePrixVente(projectId, client);
            } catch (e) { console.warn('Failed to recalculate prix_vente during bulk article update:', e?.message || e); }
        }

        await client.query('COMMIT');

        // Consolidate changes (fields + client + team) and emit a single project_updated event
        try {
            const consolidated = { ...(fieldResult?.changes || {}) };
            if (clientChanges) {
                Object.assign(consolidated, clientChanges);
            }
            if (teamDiff && (Array.isArray(teamDiff.added) || Array.isArray(teamDiff.removed))) {
                const added = Array.isArray(teamDiff.added) ? teamDiff.added : [];
                const removed = Array.isArray(teamDiff.removed) ? teamDiff.removed : [];
                const allIds = Array.from(new Set([...added, ...removed].filter((n) => Number.isFinite(Number(n))).map(Number)));
                let addedNames = [];
                let removedNames = [];
                if (allIds.length > 0) {
                    const placeholders = allIds.map((_, i) => `$${i + 1}`).join(',');
                    const resUsers = await pool.query(`SELECT id, COALESCE(nom_utilisateur, email) AS name FROM users WHERE id IN (${placeholders})`, allIds);
                    const map = new Map(resUsers.rows.map(r => [Number(r.id), r.name]));
                    addedNames = added.map(id => map.get(Number(id))).filter(Boolean);
                    removedNames = removed.map(id => map.get(Number(id))).filter(Boolean);
                }
                if (addedNames.length > 0) consolidated.equipe_ajoute = { from: null, to: `${addedNames.join(', ')} a été ajouté` };
                if (removedNames.length > 0) consolidated.equipe_retire = { from: null, to: `${removedNames.join(', ')} a été retiré` };
            }

            if (Object.keys(consolidated).length > 0) {
                const EventNotificationService = require('../services/EventNotificationService');
                await EventNotificationService.projectUpdated(projectId, userId, consolidated, isUserAction);
            }
        } catch (e) {
            console.warn('Failed to emit consolidated project_updated event:', e?.message || e);
        }

        // Broadcast real-time update for project change
        broadcastProjectChange(projectId, 'projectUpdated', { userId, isAdmin });

        cache.clear();
        return res.json({ success: true, data: { id: projectId } });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating project:', error);
        return res.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

/**
 * Delete project
 */
exports.deleteProject = async (req, res) => {
    const client = await pool.connect();

    try {
        const projectId = parseInt(req.params.id, 10);
        if (isNaN(projectId)) {
            return res.status(400).json({ success: false, message: 'Invalid project ID' });
        }

        const userId = req.user.id;
        const isAdmin = !!req.user.is_admin;

        await client.query('BEGIN');

        // Check if the project exists and user has permission
        if (!isAdmin) {
            const projectCheck = await client.query(
                'SELECT id FROM projets WHERE id = $1 AND "Ajouté_par" = $2',
                [projectId, userId]
            );

            if (projectCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    message: 'Project not found or you do not have permission to delete it'
                });
            }
        } else {
            const projectCheck = await client.query(
                'SELECT id FROM projets WHERE id = $1',
                [projectId]
            );

            if (projectCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Project not found' });
            }
        }

        // Delete project and related data
        await Project.delete(projectId, userId, client);

        await client.query('COMMIT');

        console.log(`✅ Project ${projectId} deleted successfully by user ${userId}`);

        cache.clear();
        return res.json({ success: true, data: { deleted: true } });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error deleting project:', error);
        return res.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

/**
 * Get project team members
 */
exports.getProjectTeam = async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        if (isNaN(projectId)) {
            return res.status(400).json({ success: false, message: 'Invalid project ID' });
        }

        const userId = req.user?.id;
        const isAdmin = (req.user?.is_admin === true) || (req.user?.is_admin === 'true') || (req.user?.role === 'admin');

        // Check access
        const hasAccess = await Project.checkUserAccess(projectId, userId, isAdmin);
        if (!hasAccess) {
            return res.status(404).json({
                success: false,
                message: 'Project not found or you do not have permission to view it'
            });
        }

        const team = await Project.getTeamMembers(projectId);
        return res.json({ success: true, data: team });
    } catch (error) {
        console.error('Error fetching project team:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Search users for team assignment
 */
exports.searchUsers = async (req, res) => {
    try {
        const { q: search = '' } = req.query;

        let query = `
            SELECT id, nom_utilisateur, email
            FROM users
            WHERE 1=1
        `;
        const params = [];

        if (search.trim()) {
            query += ` AND (nom_utilisateur ILIKE $1 OR email ILIKE $1)`;
            params.push(`%${search.trim()}%`);
        }

        query += ` ORDER BY nom_utilisateur, email LIMIT 50`;

        const result = await pool.query(query, params);
        return res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error searching users:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Delete a bloc or gbloc
 */
exports.deleteBloc = async (req, res) => {
    console.log('\n========== DELETE BLOC/GBLOC REQUEST ==========');
    // Using the working logic from projectRoutesOld.js
    const projectId = parseInt(req.params.id, 10);
    const blocId = parseInt(req.params.blocId, 10);

    console.log(`Project ID: ${projectId}, Bloc/Gbloc ID: ${blocId}`);

    if (isNaN(projectId) || isNaN(blocId)) {
        console.log('ERROR: Invalid IDs');
        return res.status(400).json({ success: false, message: 'Invalid project or bloc ID' });
    }

    const userId = req.user.id;
    const isAdmin = !!req.user.is_admin;

    console.log(`User ID: ${userId}, Is Admin: ${isAdmin}`);

    const client = await pool.connect();

    try {
        console.log('Starting transaction...');
        await client.query('BEGIN');

        // Verify access
        const accessCheckSql = isAdmin
            ? 'SELECT id FROM projets WHERE id = $1'
            : `SELECT p.id
               FROM projets p
               LEFT JOIN projet_equipe pe ON pe.projet = p.id AND pe.equipe = $2
               WHERE p.id = $1 AND (p."Ajouté_par" = $2 OR pe.id IS NOT NULL)`;
        const accessArgs = isAdmin ? [projectId] : [projectId, userId];
        console.log('Checking access...');
        const access = await client.query(accessCheckSql, accessArgs);

        if (access.rows.length === 0) {
            console.log('ERROR: Access denied');
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Project not found or access denied' });
        }
        console.log('Access granted');

        // If blocId actually refers to an ouvrage container, delete by ouvrage linkage
        console.log('Checking if ID is an ouvrage...');
        const ouvrageCheck = await client.query('SELECT id, nom_ouvrage FROM ouvrage WHERE id = $1 LIMIT 1', [blocId]);

        if (ouvrageCheck.rows.length > 0) {
            console.log('✓ ID is an OUVRAGE - proceeding with ouvrage deletion');
            const ouvrageName = ouvrageCheck.rows[0].nom_ouvrage;

            // Get lot information for the ouvrage before deletion
            const lotResult = await client.query(
                'SELECT DISTINCT lot FROM projet_article WHERE projet = $1 AND ouvrage = $2 AND lot IS NOT NULL LIMIT 1',
                [projectId, blocId]
            );
            const ouvrageLot = lotResult.rows.length > 0 ? lotResult.rows[0].lot : null;

            // IMPORTANT: Preserve events by setting ouvrage to NULL instead of deleting them
            console.log('Preserving related events for ouvrage by setting ouvrage to NULL...');
            const preserveEvents = await client.query('UPDATE events SET ouvrage = NULL WHERE ouvrage = $1', [blocId]);
            console.log(`Preserved ${preserveEvents.rowCount} event entries by setting ouvrage to NULL`);

            // Delete all projet_article rows linked to this ouvrage for the project
            console.log('Deleting projet_article entries for ouvrage...');
            const delArticles = await client.query('DELETE FROM projet_article WHERE projet = $1 AND ouvrage = $2', [projectId, blocId]);
            console.log(`Deleted ${delArticles.rowCount} article entries`);

            // Skip orphan bloc deletion to avoid foreign key constraint issues with events table
            // Orphan blocs will remain in the database but won't be visible in any project
            console.log('Skipping orphan bloc deletion (to avoid FK constraint issues)');

            // Finally delete the ouvrage itself
            console.log('Deleting ouvrage itself...');
            const delOuvrage = await client.query('DELETE FROM ouvrage WHERE id = $1 RETURNING id', [blocId]);
            console.log(`Deleted ouvrage, rowCount: ${delOuvrage.rowCount}`);

            // Recalculate project's selling price after ouvrage deletion (inside transaction)
            // Recalculate project's selling price after ouvrage deletion (inside transaction)
            if (delOuvrage.rowCount > 0 || delArticles.rowCount > 0) {
                const Project = require('../models/Project');
                // Ensure price is updated transactionally
                await Project.recalculatePrixVente(projectId, client);
                console.log('✅ Recalculated prix_vente after ouvrage deletion');
            }

            // Create deletion event after successful deletion
            if (delOuvrage.rowCount > 0 && ouvrageName) {
                console.log('Creating ouvrage deletion event...');
                try {
                    const EventNotificationService = require('../services/EventNotificationService');
                    await EventNotificationService.gblocDeleted(projectId, blocId, userId, ouvrageName, ouvrageLot);
                    console.log('✅ Ouvrage deletion event created successfully');
                } catch (eventError) {
                    console.error('❌ Failed to create ouvrage deletion event:', eventError);
                }
            }

            await client.query('COMMIT');

            console.log('SUCCESS: Gbloc deleted successfully');
            console.log('========================================\n');
            return res.json({ success: true, data: { deleted_gbloc: delOuvrage.rowCount } });
        }

        // Otherwise, treat as a normal bloc deletion: remove articles scoped to this project, then delete the bloc row
        console.log('✓ ID is a BLOC - proceeding with bloc deletion');

        // Get bloc name before deletion for event creation
        const blocCheck = await client.query('SELECT id, nom_bloc FROM bloc WHERE id = $1 LIMIT 1', [blocId]);
        if (blocCheck.rows.length === 0) {
            console.log('ERROR: Bloc not found');
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Bloc not found' });
        }
        const blocName = blocCheck.rows[0].nom_bloc;

        // ✅ CRITICAL FIX: Get ouvrage context before deletion
        // Check which ouvrage(s) use this bloc to scope deletion properly
        const ouvrageContextCheck = await client.query(
            'SELECT DISTINCT ouvrage FROM projet_article WHERE projet = $1 AND bloc = $2 AND ouvrage IS NOT NULL',
            [projectId, blocId]
        );
        const ouvrageIds = ouvrageContextCheck.rows.map(r => r.ouvrage);
        const ouvrageId = req.body.ouvrageId || req.query.ouvrageId || null;

        // If bloc is used by multiple ouvrages and no ouvrageId provided, require it
        if (ouvrageIds.length > 1 && !ouvrageId) {
            console.log('ERROR: Bloc is used by multiple ouvrages, ouvrageId required');
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: `Bloc is used by ${ouvrageIds.length} ouvrages. Please specify ouvrageId in request body or query parameter.`
            });
        }

        const targetOuvrageId = ouvrageId || ouvrageIds[0] || null;

        // ✅ FIX: Get lot information for the bloc before deletion and resolve to name
        let blocLot = null;
        let resolvedLotName = null;
        if (targetOuvrageId) {
            const lotResult = await client.query(
                'SELECT DISTINCT lot FROM projet_article WHERE projet = $1 AND bloc = $2 AND ouvrage = $3 AND lot IS NOT NULL LIMIT 1',
                [projectId, blocId, targetOuvrageId]
            );
            if (lotResult.rows.length > 0) {
                blocLot = lotResult.rows[0].lot;
            }
        } else {
            const lotResult = await client.query(
                'SELECT DISTINCT lot FROM projet_article WHERE projet = $1 AND bloc = $2 AND lot IS NOT NULL LIMIT 1',
                [projectId, blocId]
            );
            if (lotResult.rows.length > 0) {
                blocLot = lotResult.rows[0].lot;
            }
        }

        // Resolve lot ID to name if needed
        if (blocLot && (typeof blocLot === 'number' || (typeof blocLot === 'string' && /^\d+$/.test(blocLot)))) {
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
        } else if (blocLot) {
            resolvedLotName = blocLot; // Already a name
        }

        // IMPORTANT: Preserve events by setting bloc_id to NULL instead of deleting them
        console.log('Preserving related events for bloc by setting bloc_id to NULL...');
        const preserveBlocEvents = await client.query('UPDATE events SET bloc = NULL WHERE bloc = $1', [blocId]);
        console.log(`Preserved ${preserveBlocEvents.rowCount} event entries by setting bloc_id to NULL`);

        // ✅ CRITICAL FIX: Scope deletion by ouvrage to prevent cross-ouvrage deletion
        console.log(`Deleting projet_article entries for bloc ${blocId} in ouvrage ${targetOuvrageId || 'all'}...`);
        let delArticles;
        if (targetOuvrageId) {
            // Delete only articles in this specific ouvrage + bloc combination
            delArticles = await client.query(
                'DELETE FROM projet_article WHERE projet = $1 AND ouvrage = $2 AND bloc = $3',
                [projectId, targetOuvrageId, blocId]
            );
            console.log(`Deleted ${delArticles.rowCount} article entries for bloc ${blocId} in ouvrage ${targetOuvrageId}`);

            // Check if this bloc is still used by other ouvrages
            const otherOuvragesCheck = await client.query(
                'SELECT COUNT(DISTINCT ouvrage) as ouvrage_count FROM projet_article WHERE projet = $1 AND bloc = $2 AND ouvrage IS NOT NULL',
                [projectId, blocId]
            );
            const otherOuvragesCount = parseInt(otherOuvragesCheck.rows[0]?.ouvrage_count || 0, 10);

            if (otherOuvragesCount > 0) {
                // Bloc is still used by other ouvrages - don't delete the bloc record
                console.log(`Bloc ${blocId} is still used by ${otherOuvragesCount} other ouvrage(s) - keeping bloc record`);
                await client.query('COMMIT');
                return res.json({
                    success: true,
                    data: {
                        deleted: delArticles.rowCount,
                        bloc_kept: true,
                        message: `Deleted articles from ouvrage ${targetOuvrageId}. Bloc record kept (used by other ouvrages).`
                    }
                });
            }
        } else {
            // No ouvrage context - delete all articles (legacy behavior, but log warning)
            console.warn(`⚠️ Deleting bloc ${blocId} without ouvrage context - this may affect multiple ouvrages!`);
            delArticles = await client.query(
                'DELETE FROM projet_article WHERE projet = $1 AND bloc = $2',
                [projectId, blocId]
            );
            console.log(`Deleted ${delArticles.rowCount} article entries for bloc ${blocId} (no ouvrage context)`);
        }

        console.log('Deleting bloc itself...');
        const del = await client.query('DELETE FROM bloc WHERE id = $1 RETURNING id', [blocId]);
        console.log(`Deleted bloc, rowCount: ${del.rowCount}`);

        // Ensure the lot persists even if this was the last bloc
        if (blocLot) {
            console.log('Ensuring lot persists after bloc deletion if empty...');
            const cntRes = await client.query(
                'SELECT COUNT(*)::int AS cnt FROM projet_article WHERE projet = $1 AND lot = $2',
                [projectId, blocLot]
            );
            const remaining = (cntRes.rows[0]?.cnt || 0);
            if (remaining === 0) {
                console.log(`No remaining entries for lot "${blocLot}". Inserting placeholder row with NULL bloc.`);
                const paIdCheck = await client.query(`
                    SELECT column_default FROM information_schema.columns
                    WHERE table_name = 'projet_article' AND column_name = 'id'
                `);
                if (paIdCheck.rows[0]?.column_default) {
                    await client.query(
                        `INSERT INTO projet_article (projet, lot, bloc, designation_article, designation_lot)
                         VALUES ($1, $2, NULL, NULL, NULL)`,
                        [projectId, blocLot]
                    );
                } else {
                    const maxPa = await client.query('SELECT COALESCE(MAX(id), 0) AS max_id FROM projet_article');
                    const nextPa = maxPa.rows[0].max_id + 1;
                    await client.query(
                        `INSERT INTO projet_article (id, projet, lot, bloc, designation_article, designation_lot)
                         VALUES ($1, $2, $3, NULL, NULL, NULL)`,
                        [nextPa, projectId, blocLot]
                    );
                }
            }
        }

        // Always recalculate project's selling price after bloc deletion (inside transaction)
        // Even if deletion failed, we need to recalculate because articles might have been deleted
        try {
            const Project = require('../models/Project');
            await Project.recalculatePrixVente(projectId, client);
            console.log(`✅ Recalculated prix_vente after bloc deletion (deleted ${delArticles.rowCount} articles, ${del.rowCount} bloc)`);
        } catch (recalcError) {
            console.error('❌ Failed to recalculate prix_vente after deleting bloc:', recalcError);
            // Don't throw - the bloc was deleted successfully
        }

        // Create deletion event after successful deletion
        if (del.rowCount > 0 && blocName) {
            console.log('Creating bloc deletion event...');
            try {
                const EventNotificationService = require('../services/EventNotificationService');
                // ✅ FIX: Pass ouvrage ID (gblocId) and resolved lot name to blocDeleted
                await EventNotificationService.blocDeleted(projectId, blocId, userId, blocName, resolvedLotName || blocLot, targetOuvrageId);
                console.log('✅ Bloc deletion event created successfully');
            } catch (eventError) {
                console.error('❌ Failed to create bloc deletion event:', eventError);
            }
        }

        await client.query('COMMIT');

        console.log('SUCCESS: Bloc deleted successfully');
        console.log('========================================\n');
        return res.json({ success: true, data: { deleted: del.rowCount } });

    } catch (e) {
        console.error('\n❌ ERROR during deletion:');
        console.error('Error message:', e.message);
        console.error('Error stack:', e.stack);
        console.error('========================================\n');
        await client.query('ROLLBACK');
        return res.status(500).json({ success: false, message: e.message });
    } finally {
        client.release();
    }
};

/**
 * Delete a lot with conditional GBloc deletion
 */
exports.deleteLot = async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const lotName = decodeURIComponent(req.params.lotName || '');

        if (isNaN(projectId) || !lotName || String(lotName).trim() === '') {
            return res.status(400).json({ success: false, message: 'Invalid project ID or lot name' });
        }

        const userId = req.user.id;
        const isAdmin = !!req.user.is_admin;

        const result = await Lot.delete(projectId, lotName, userId);

        return res.json({
            success: true,
            data: {
                deleted: result
            },
            message: `Lot "${lotName}" deleted successfully`
        });
    } catch (error) {
        console.error('Error deleting lot:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Update a gbloc
 */
exports.updateGbloc = async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const gblocId = parseInt(req.params.gblocId, 10);
        const { nom_gbloc, designation } = req.body || {};

        if (isNaN(projectId) || isNaN(gblocId)) {
            return res.status(400).json({ success: false, message: 'Invalid project or gbloc ID' });
        }

        const userId = req.user.id;
        const isAdmin = !!req.user.is_admin;

        // ✅ VALIDATION DES DONNÉES : Validation complète avant mise à jour
        const client = await pool.connect();
        try {
            const validationData = {
                nom_ouvrage: nom_gbloc,
                designation: designation
            };

            const validation = await validateOuvrageData(client, projectId, validationData, gblocId);

            if (!validation.isValid) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation échouée',
                    errors: validation.errors
                });
            }

            // Map nom_gbloc to nom_ouvrage for Gbloc.update
            const updateData = {};
            if (nom_gbloc !== undefined) {
                updateData.nom_ouvrage = validation.validatedData.nom_ouvrage;
            }
            if (designation !== undefined) {
                updateData.designation = validation.validatedData.designation;
            }

            const result = await Gbloc.update(gblocId, updateData, userId, projectId);

            // Broadcast real-time update for gbloc change
            broadcastProjectChange(projectId, 'gblocUpdated', { gblocId, nom_gbloc: updateData.nom_ouvrage || result.nom_ouvrage, designation: updateData.designation || result.designation, userId });

            return res.json({ success: true, data: result });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error updating gbloc:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Update a bloc
 */
exports.updateBloc = async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const blocId = parseInt(req.params.blocId, 10);

        if (isNaN(projectId) || isNaN(blocId)) {
            return res.status(400).json({ success: false, message: 'Invalid project or bloc ID' });
        }

        const userId = req.user.id;
        const isAdmin = !!req.user.is_admin;

        // ✅ VALIDATION DES DONNÉES : Validation complète avant mise à jour
        const client = await pool.connect();
        try {
            // Extraire uniquement les champs pertinents pour la validation
            const validationData = {};
            if (req.body.nom_bloc !== undefined) validationData.nom_bloc = req.body.nom_bloc;
            if (req.body.designation !== undefined) validationData.designation = req.body.designation;

            // Si aucun champ à valider, procéder normalement
            if (Object.keys(validationData).length === 0) {
                const result = await Bloc.update(projectId, blocId, req.body, userId, isAdmin);
                broadcastProjectChange(projectId, 'blocUpdated', { blocId, body: req.body, userId });
                return res.json({ success: true, data: result });
            }

            const validation = await validateBlocData(client, projectId, validationData, blocId);

            if (!validation.isValid) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation échouée',
                    errors: validation.errors
                });
            }

            // Créer un nouvel objet body avec les données validées
            const validatedBody = { ...req.body };
            if (validation.validatedData.nom_bloc !== undefined) {
                validatedBody.nom_bloc = validation.validatedData.nom_bloc;
            }
            if (validation.validatedData.designation !== undefined) {
                validatedBody.designation = validation.validatedData.designation;
            }

            const result = await Bloc.update(projectId, blocId, validatedBody, userId, isAdmin);

            // Broadcast real-time update for bloc change
            broadcastProjectChange(projectId, 'blocUpdated', { blocId, body: validatedBody, userId });

            return res.json({ success: true, data: result });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error updating bloc:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Duplicate a gbloc (grand bloc)
 */
exports.duplicateGbloc = async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const sourceGblocId = parseInt(req.params.gblocId, 10);
        const { nom_gbloc, designation } = req.body || {};

        if (isNaN(projectId) || isNaN(sourceGblocId)) {
            return res.status(400).json({ success: false, message: 'Invalid project or gbloc ID' });
        }
        if (!nom_gbloc || String(nom_gbloc).trim() === '') {
            return res.status(400).json({ success: false, message: 'nom_gbloc est requis' });
        }

        const userId = req.user.id;
        const isAdmin = !!req.user.is_admin;

        const result = await Project.duplicateGbloc(projectId, sourceGblocId, nom_gbloc, userId, isAdmin, designation);
        return res.json({ success: true, data: result });
    } catch (error) {
        console.error('Error duplicating gbloc:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Bloc duplication removed - only ouvrage duplication is allowed
// Lot duplication removed - only ouvrage duplication is allowed

module.exports = {
    getAllProjects: exports.getAllProjects,
    getProjectById: exports.getProjectById,
    createProject: exports.createProject,
    updateProject: exports.updateProject,
    deleteProject: exports.deleteProject,
    getProjectTeam: exports.getProjectTeam,
    searchUsers: exports.searchUsers,
    deleteBloc: exports.deleteBloc,
    deleteLot: exports.deleteLot,
    updateGbloc: exports.updateGbloc,
    updateBloc: exports.updateBloc,
    duplicateGbloc: exports.duplicateGbloc,
    getProjectPrice: exports.getProjectPrice
};
