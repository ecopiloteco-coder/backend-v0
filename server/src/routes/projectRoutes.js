const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const projectController = require('../controllers/projectController');
const Project = require('../models/Project');
const Article = require('../models/Article');
const Bloc = require('../models/Bloc');
const Lot = require('../models/Lot');
const Gbloc = require('../models/Gbloc');
const pool = require('../../config/db');
const DesignationHelper = require('../utils/designationHelper');
const EventNotificationService = require('../services/EventNotificationService');
const HierarchyService = require('../services/HierarchyService');
const ProjectArticle = require('../models/ProjectArticle');
const { validateOuvrageData, validateBlocData } = require('../utils/validationHelper');

// Import the shared event emitter from eventBus
const { projectEvents } = require('../utils/eventBus');

/**
 * @route   GET /api/projects
 * @desc    Get all projects with pagination and search
 * @access  Private
 */
router.get('/', authMiddleware, projectController.getAllProjects);

router.get('/my-projects', authMiddleware, (req, res) => {
    req.query.scope = 'team';
    return projectController.getAllProjects(req, res);
});

/**
 * @route   GET /api/projects/:id/events
 * @desc    Server-Sent Events endpoint for real-time project updates
 * @access  Private
 */
router.get('/:id/events', authMiddleware, (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    // Initialize global subscribers map if not exists
    if (!global.projectSubscribers) {
        global.projectSubscribers = new Map();
    }

    // Add client to global subscribers for direct notifications
    if (!global.projectSubscribers.has(projectId.toString())) {
        global.projectSubscribers.set(projectId.toString(), new Set());
    }
    global.projectSubscribers.get(projectId.toString()).add(res);

    console.log(`SSE client connected for project ${projectId}`);

    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send initial connection event
    const initialEvent = `data: {"type":"connected","projectId":${projectId}}\n\n`;
    res.write(initialEvent);
    console.log('Sent initial SSE event:', initialEvent.trim());

    // Listen for project changes via EventBus (for legacy/other controller support)
    const onProjectChange = (data) => {
        console.log(`Project change detected for project ${data.projectId}, client project ${projectId}`);
        if (data.projectId === projectId) {
            const eventData = `data: ${JSON.stringify({ type: 'projectChanged', changeType: data.type, payload: data })}\n\n`;
            console.log('Broadcasting SSE event:', eventData.trim());
            res.write(eventData);
        }
    };

    projectEvents.on('projectChanged', onProjectChange);

    // Clean up on client disconnect
    req.on('close', () => {
        console.log(`SSE client disconnected for project ${projectId}`);
        projectEvents.removeListener('projectChanged', onProjectChange);

        // Remove from global subscribers
        if (global.projectSubscribers && global.projectSubscribers.has(projectId.toString())) {
            const subscribers = global.projectSubscribers.get(projectId.toString());
            subscribers.delete(res);
            if (subscribers.size === 0) {
                global.projectSubscribers.delete(projectId.toString());
            }
        }
    });
});

/**
 * @route   GET /api/projects/users/search
 * @desc    Search users for team assignment
 * @access  Private
 */
router.get('/users/search', authMiddleware, projectController.searchUsers);

/**
 * @route   GET /api/projects/:id/articles
 * @desc    Get all articles for a project with pagination
 * @access  Private
 */
router.get('/:id/articles', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;

    try {
        const result = await Project.getProjectArticles(projectId, {
            page,
            limit,
            userId: req.user.id,
            isAdmin: (req.user?.is_admin === true) || (req.user?.is_admin === 'true') || (req.user?.role === 'admin')
        });
        return res.json({ success: true, ...result });
    } catch (e) {
        console.error('Error loading project articles:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   GET /api/projects/:id/price
 * @desc    Get project price only (Optimized)
 * @access  Private
 */
router.get('/:id/price', authMiddleware, projectController.getProjectPrice);

/**
 * @route   GET /api/projects/:id
 * @desc    Get project by ID
 * @access  Private
 */
router.get('/:id', authMiddleware, projectController.getProjectById);

/**
 * @route   GET /api/projects/:id/price
 * @desc    Get project price only (Optimized)
 * @access  Private
 */
router.get('/:id/price', authMiddleware, projectController.getProjectPrice);

/**
 * @route   POST /api/projects
 * @desc    Create a new project
 * @access  Private
 */
router.post('/', authMiddleware, projectController.createProject);

/**
 * @route   PUT /api/projects/:id
 * @desc    Update project
 * @access  Private
 */
router.put('/:id', authMiddleware, projectController.updateProject);


/**
 * @route   DELETE /api/projects/:id
 * @desc    Delete project
 * @access  Private
 */
router.delete('/:id', authMiddleware, projectController.deleteProject);

/**
 * @route   GET /api/projects/:id/team
 * @desc    Get project team members
 * @access  Private
 */
router.get('/:id/team', authMiddleware, projectController.getProjectTeam);

// ==================== NEW HIERARCHY API ENDPOINTS ====================

/**
 * @route   GET /api/projects/:id/lots
 * @desc    Get all lots for a project (for UI tabs/navigation)
 * @access  Private
 */
router.get('/:id/lots', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    const { includeCounts = true, orderBy = 'lot' } = req.query;

    try {
        const lots = await HierarchyService.getProjectLots(projectId, {
            includeCounts: includeCounts === 'true',
            orderBy
        });
        return res.json({ success: true, data: lots });
    } catch (e) {
        console.error('Error getting project lots:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   GET /api/projects/:id/gblocs
 * @desc    Get all GBlocs for a project (grouped by niv_1 + lot + gbloc)
 * @access  Private
 */
router.get('/:id/gblocs', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    const { includeTotals = true, includeCounts = true, lot } = req.query;

    try {
        const gblocs = await HierarchyService.getProjectGblocs(projectId, {
            includeTotals: includeTotals === 'true',
            includeCounts: includeCounts === 'true',
            lotFilter: lot || null // Use 'lot' query param, default to null
        });
        return res.json({ success: true, data: gblocs });
    } catch (e) {
        console.error('Error getting project gblocs:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   POST /api/projects/:id/gblocs
 * @desc    Create a new GBloc with proper hierarchy
 * @access  Private
 */
router.post('/:id/gblocs', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    const { lot, gbloc, gbloc_name, designation, child_bloc } = req.body || {};

    // ✅ VALIDATION AMÉLIORÉE : Vérification des champs requis
    if (!lot || !gbloc) {
        return res.status(400).json({
            success: false,
            message: 'lot and gbloc are required'
        });
    }

    try {
        const client = await pool.connect();
        try {
            // ✅ VALIDATION DES DONNÉES : Validation complète des données d'ouvrage
            const validationData = {
                nom_ouvrage: gbloc_name || gbloc,
                designation: designation
            };

            const validation = await validateOuvrageData(client, projectId, validationData);

            if (!validation.isValid) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation échouée',
                    errors: validation.errors
                });
            }

            // Use Project.createGbloc which creates events
            const newGbloc = await Project.createGbloc(projectId, {
                lot,
                niveau3: gbloc,
                designation: validation.validatedData.designation,
                prix_total: null,
                child_bloc: child_bloc || (req.body.addBloc && req.body.bloc_name ? {
                    nom_bloc: req.body.bloc_name,
                    unite: req.body.unite || null,
                    quantite: req.body.quantite ? parseFloat(req.body.quantite) : null
                } : null)
            }, req.user.id, !!req.user.is_admin);

            return res.json({ success: true, data: newGbloc });
        } finally {
            client.release();
        }
    } catch (e) {
        console.error('Error creating gbloc:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   GET /api/projects/:id/gblocs/:gblocKey/blocs
 * @desc    Get all Blocs within a GBloc (gblocKey = niv_1:lot:gbloc)
 * @access  Private
 */
router.get('/:id/gblocs/:gblocKey/blocs', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    const { gblocKey } = req.params;
    const { includeTotals = true, includeCounts = true } = req.query;

    try {
        // Parse gblocKey format: lot:gbloc_id (gbloc_id is integer ID, no niv_1 anymore)
        const parts = decodeURIComponent(gblocKey).split(':');
        if (parts.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Invalid gblocKey format. Use: lot:gbloc_id'
            });
        }
        const [lot, gblocIdStr] = parts;
        const gblocId = parseInt(gblocIdStr, 10);

        if (isNaN(gblocId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid gblocKey format. gbloc_id (integer) is required'
            });
        }

        const blocs = await HierarchyService.getGblocBlocs(projectId, {
            lot: lot || null, // lot can be empty string, treat as null
            gbloc_id: gblocId
        }, {
            includeTotals: includeTotals === 'true',
            includeCounts: includeCounts === 'true'
        });
        return res.json({ success: true, data: blocs });
    } catch (e) {
        console.error('Error getting gbloc blocs:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   POST /api/projects/:id/niveau1-only
 * @desc    Create a Niveau 1 entry without an associated gbloc (placeholder projet_article row)
 * @access  Private
 */
router.post('/:id/niveau1-only', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    const { lot } = req.body || {};
    if (!lot || String(lot).trim() === '') {
        return res.status(400).json({ success: false, message: 'lot is required' });
    }

    try {
        const result = await HierarchyService.createNiveau1Only(projectId, {
            lot: String(lot).trim()
        });

        return res.json({ success: true, data: result });
    } catch (e) {
        console.error('Error creating niveau1-only entry:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   POST /api/projects/:id/gblocs/:gblocKey/blocs
 * @desc    Create a new Bloc within a GBloc
 * @access  Private
 */
router.post('/:id/gblocs/:gblocKey/blocs', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    const { gblocKey } = req.params;
    const { bloc, bloc_name } = req.body || {};

    try {
        // Parse gblocKey format: lot:gbloc_id (gbloc_id is integer ID, no niv_1 anymore)
        const parts = decodeURIComponent(gblocKey).split(':');
        if (parts.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Invalid gblocKey format. Use: lot:gbloc_id'
            });
        }
        const [lot, gblocIdStr] = parts;
        const gblocId = parseInt(gblocIdStr, 10);

        if (isNaN(gblocId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid gblocKey format. gbloc_id (integer) is required'
            });
        }

        if (!bloc) {
            return res.status(400).json({
                success: false,
                message: 'bloc is required'
            });
        }

        const { unite, quantite, designation } = req.body || {};

        try {
            const client = await pool.connect();
            try {
                // ✅ VALIDATION DES DONNÉES : Validation complète des données de bloc
                const validationData = {
                    nom_bloc: bloc_name || bloc,
                    designation: designation
                };

                const validation = await validateBlocData(client, projectId, validationData);

                if (!validation.isValid) {
                    return res.status(400).json({
                        success: false,
                        message: 'Validation échouée',
                        errors: validation.errors
                    });
                }

                const newBloc = await Bloc.create(projectId, {
                    nom_bloc: validation.validatedData.nom_bloc,
                    unite: unite || null,
                    quantite: quantite ? parseFloat(quantite) : null,
                    lot: lot || null,
                    ouvrage: gblocId,
                    designation: validation.validatedData.designation
                }, req.user.id, !!req.user.is_admin);

                return res.json({ success: true, data: newBloc });
            } finally {
                client.release();
            }
        } catch (e) {
            console.error('Error creating bloc:', e);
            return res.status(500).json({ success: false, message: e.message });
        }
    } catch (e) {
        console.error('Error creating bloc:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   GET /api/projects/:id/blocs/:blocKey/articles
 * @desc    Get all articles within a Bloc (blocKey = lot:gbloc:bloc)
 * @access  Private
 */
router.get('/:id/blocs/:blocKey/articles', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    const { blocKey } = req.params;
    const { includeDetails = true, page = 1, limit = 100 } = req.query;

    try {
        // Parse blocKey format: lot:gbloc_id:bloc_id (both IDs are integers, no niv_1 anymore)
        const parts = decodeURIComponent(blocKey).split(':');
        if (parts.length < 3) {
            return res.status(400).json({
                success: false,
                message: 'Invalid blocKey format. Use: lot:gbloc_id:bloc_id'
            });
        }
        const [lot, gblocIdStr, blocIdStr] = parts;
        const gblocId = parseInt(gblocIdStr, 10);
        const blocId = parseInt(blocIdStr, 10);

        // Allow blocId to be 0 (adding directly to ouvrage/gbloc)
        if (isNaN(gblocId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid blocKey format. gbloc_id (integer) is required'
            });
        }

        const result = await HierarchyService.getBlocArticles(projectId, {
            lot: lot || null, // lot can be empty string, treat as null
            gbloc_id: gblocId,
            bloc_id: blocId > 0 ? blocId : null // null when bloc_id is 0 (direct to ouvrage)
        }, {
            includeDetails: includeDetails === 'true',
            page: parseInt(page),
            limit: parseInt(limit)
        });
        return res.json({ success: true, data: result });
    } catch (e) {
        console.error('Error getting bloc articles:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   GET /api/projects/:id/totals
 * @desc    Get project totals aggregated from projet_article
 * @access  Private
 */
router.get('/:id/totals', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    try {
        const totals = await HierarchyService.getProjectTotals(projectId);
        return res.json({ success: true, data: totals });
    } catch (e) {
        console.error('Error getting project totals:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   POST /api/projects/:id/blocs/:blocKey/articles
 * @desc    Add a catalogue article to a bloc
 * @access  Private
 */
router.post('/:id/blocs/:blocKey/articles', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    const { blocKey } = req.params;
    const { catalogueId, quantity = 1, tva, localisation, description, nouv_prix } = req.body || {};

    try {
        // Parse blocKey format: lot:gbloc_id:bloc_id (both IDs are integers, no niv_1 anymore)
        const parts = decodeURIComponent(blocKey).split(':');
        if (parts.length < 3) {
            return res.status(400).json({
                success: false,
                message: 'Invalid blocKey format. Use: lot:gbloc_id:bloc_id'
            });
        }
        const [lot, gblocIdStr, blocIdStr] = parts;
        const gblocId = parseInt(gblocIdStr, 10);
        const blocId = parseInt(blocIdStr, 10);

        // Allow blocId to be 0 to indicate adding directly to ouvrage (no bloc)
        if (isNaN(gblocId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid blocKey format. gbloc_id (integer) is required'
            });
        }

        if (!catalogueId) {
            return res.status(400).json({
                success: false,
                message: 'catalogueId is required'
            });
        }

        // Verify that the ouvrage exists
        const ouvrageCheck = await pool.query('SELECT id FROM ouvrage WHERE id = $1', [gblocId]);
        if (ouvrageCheck.rows.length === 0) {
            console.error(`[Add Article] Ouvrage ${gblocId} does not exist`);
            return res.status(400).json({
                success: false,
                message: `Ouvrage with id ${gblocId} does not exist`
            });
        }

        // If blocId is 0, we're adding directly to ouvrage (no bloc)
        // Otherwise, verify that the bloc exists in the bloc table
        if (blocId > 0) {
            const blocCheck = await pool.query('SELECT id, nom_bloc FROM bloc WHERE id = $1', [blocId]);
            if (blocCheck.rows.length === 0) {
                console.error(`[Add Article] Bloc ${blocId} does not exist in bloc table`);
                return res.status(400).json({
                    success: false,
                    message: `Bloc with id ${blocId} does not exist. Please create the bloc first.`
                });
            }
            console.log(`[Add Article] Attempting to add article ${catalogueId} to bloc ${blocId} in gbloc ${gblocId}`);
        } else {
            console.log(`[Add Article] Attempting to add article ${catalogueId} directly to ouvrage (gbloc ${gblocId})`);
        }

        console.log(`[Add Article] Hierarchy: lot="${lot}", gbloc_id=${gblocId}, bloc_id=${blocId || 'none (direct to ouvrage)'}`);

        // Ensure lot parameter is present; if missing, derive from ouvrage -> projet_lot
        let lotParam = lot || null;
        if (!lotParam || String(lotParam).trim() === '') {
            try {
                const deriveRes = await pool.query(
                    `SELECT pl.id_lot AS lot
                     FROM ouvrage o
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE pl.id_projet = $1 AND o.id = $2
                     LIMIT 1`,
                    [projectId, gblocId]
                );
                const derivedLot = deriveRes.rows[0]?.lot || null;
                if (derivedLot) {
                    lotParam = derivedLot;
                }
            } catch (deriveErr) {
                console.warn('⚠️ Failed to derive lot from ouvrage/projet_lot:', deriveErr?.message || deriveErr);
            }
        }

        let newArticle;
        if (blocId > 0) {
            newArticle = await ProjectArticle.addArticleToBloc(
                projectId,
                lotParam || null,
                gblocId,
                blocId,
                catalogueId,
                quantity,
                { tva, localisation, description, nouv_prix }
            );
        } else {
            newArticle = await ProjectArticle.addArticleToOuvrage(
                projectId,
                lotParam || null,
                gblocId,
                catalogueId,
                quantity,
                { tva, localisation, description, nouv_prix }
            );
        }

        // ✅ CRITICAL FIX: Recalculate prix_total and pt/pu after adding article
        if (newArticle) {
            // Recalculate ouvrage prix_total
            if (gblocId) {
                try {
                    await Gbloc.recalculatePrixTotal(gblocId, projectId);
                    console.log(`✅ Recalculated prix_total for ouvrage ${gblocId} after adding article`);
                } catch (recalcError) {
                    console.error(`❌ Failed to recalculate prix_total for ouvrage ${gblocId}:`, recalcError);
                }
            }

            // Recalculate bloc pt/pu if article was added to a bloc
            if (blocId > 0) {
                try {
                    const totalResult = await pool.query(
                        `SELECT COALESCE(SUM(pa.total_ttc), 0)::float AS total_ttc 
                         FROM projet_article pa
                         INNER JOIN structure s ON s.id_structure = pa.structure
                         INNER JOIN ouvrage o ON o.id = s.ouvrage
                         INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                         WHERE pl.id_projet = $1 AND s.bloc = $2`,
                        [projectId, blocId]
                    );
                    const total = totalResult.rows[0]?.total_ttc || 0;
                    const quantiteResult = await pool.query('SELECT quantite FROM bloc WHERE id = $1', [blocId]);
                    const quantite = Number(quantiteResult.rows[0]?.quantite) || 0;
                    const pu = quantite > 0 ? total / quantite : null;
                    await pool.query('UPDATE bloc SET pt = $1, pu = $2 WHERE id = $3', [total, pu, blocId]);
                    console.log(`✅ Updated bloc ${blocId}: pt=${total}, pu=${pu}`);
                } catch (blocError) {
                    console.error(`❌ Failed to update bloc ${blocId} pt/pu:`, blocError);
                }
            }
        }

        // Create event after successful addition
        if (newArticle) {
            setImmediate(async () => {
                try {
                    // Get article name
                    const articleResult = await pool.query(
                        'SELECT nom_article FROM articles WHERE "ID" = $1',
                        [catalogueId]
                    );
                    const articleName = articleResult.rows[0]?.nom_article || null;

                    // Get bloc name if bloc exists
                    let blocName = null;
                    if (blocId > 0) {
                        const blocResult = await pool.query('SELECT nom_bloc FROM bloc WHERE id = $1', [blocId]);
                        blocName = blocResult.rows[0]?.nom_bloc || null;
                    }

                    // Get ouvrage name
                    let gblocName = null;
                    if (gblocId) {
                        const ouvrageResult = await pool.query('SELECT nom_ouvrage FROM ouvrage WHERE id = $1', [gblocId]);
                        gblocName = ouvrageResult.rows[0]?.nom_ouvrage || null;
                    }

                    // Get lot from the actual projet_article row that was just inserted
                    // This is more reliable than using the parsed blocKey
                    let lotName = null;
                    let storedLotId = null; // Declare outside try block to avoid scope issues

                    console.log('🔍 Starting lot resolution for article addition:', { blocId, gblocId, lot, projectId, catalogueId });

                    try {
                        // Query the most recent projet_article entry for this article in this project
                        // Match by project, article, ouvrage, and bloc (if bloc exists)
                        let paResult;
                        if (blocId > 0) {
                            paResult = await pool.query(
                                'SELECT lot FROM projet_article WHERE projet = $1 AND article = $2 AND ouvrage = $3 AND bloc = $4 ORDER BY id DESC LIMIT 1',
                                [projectId, catalogueId, gblocId, blocId]
                            );
                        } else {
                            paResult = await pool.query(
                                'SELECT lot FROM projet_article WHERE projet = $1 AND article = $2 AND ouvrage = $3 AND bloc IS NULL ORDER BY id DESC LIMIT 1',
                                [projectId, catalogueId, gblocId]
                            );
                        }
                        storedLotId = paResult.rows[0]?.lot || null;

                        if (storedLotId) {
                            // Fetch lot name from database
                            try {
                                // Try niveau_2 first (most common), then Niveau_2__lot as fallback
                                let lotResult;
                                try {
                                    lotResult = await pool.query('SELECT niveau_2 FROM niveau_2 WHERE id_niveau_2 = $1', [storedLotId]);
                                    lotName = lotResult.rows[0]?.niveau_2 || null;
                                } catch (e1) {
                                    // Fallback to Niveau_2__lot if niveau_2 doesn't exist
                                    try {
                                        lotResult = await pool.query('SELECT "Niveau_2__lot" FROM niveau_2 WHERE id_niveau_2 = $1', [storedLotId]);
                                        lotName = lotResult.rows[0]?.Niveau_2__lot || null;
                                    } catch (e2) {
                                        console.warn('⚠️ Both column names failed for lot in route:', e1.message, e2.message);
                                    }
                                }
                                console.log('🔍 Fetched lot name for addition event from projet_article:', { storedLotId, lotName });
                            } catch (lotError) {
                                console.warn('⚠️ Failed to fetch lot name for event:', lotError.message);
                            }
                        } else {
                            console.log('⚠️ No lot found in projet_article for article:', catalogueId);
                        }
                    } catch (paError) {
                        console.warn('⚠️ Failed to get lot from projet_article:', paError.message);
                        // Fallback: Use lot from blocKey if it's a number
                        if (lot && /^\d+$/.test(lot)) {
                            storedLotId = parseInt(lot, 10);
                            console.log('✅ Using lot ID from blocKey:', storedLotId);
                            // Fetch lot name
                            try {
                                const lotResult = await pool.query('SELECT niveau_2, "Niveau_2__lot" FROM niveau_2 WHERE id_niveau_2 = $1', [storedLotId]);
                                if (lotResult.rows[0]) {
                                    lotName = lotResult.rows[0].niveau_2 || lotResult.rows[0]['Niveau_2__lot'];
                                }
                            } catch (e) {
                                console.warn('⚠️ Failed to fetch lot name:', e.message);
                            }
                        } else if (lot && typeof lot === 'string' && !/^\d+$/.test(lot)) {
                            lotName = lot;
                        }
                    }

                    console.log('🔍 Before bloc fallback check:', { storedLotId, blocId, willTryBlocFallback: !storedLotId && blocId > 0 });

                    // Additional fallback: If we still don't have a lot ID but we have a bloc, get lot from the bloc's parent ouvrage
                    if (!storedLotId && blocId > 0) {
                        try {
                            console.log('🔍 Trying to get lot from bloc\'s parent ouvrage, blocId:', blocId);
                            const blocLotRes = await pool.query(`
                                SELECT pl.id_lot as lot_id, n2.niveau_2 as lot_name
                                FROM bloc b
                                INNER JOIN ouvrage o ON o.id = b.ouvrage
                                INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                                LEFT JOIN niveau_2 n2 ON n2.id_niveau_2 = pl.id_lot
                                WHERE b.id = $1
                            `, [blocId]);

                            if (blocLotRes.rows[0]) {
                                storedLotId = blocLotRes.rows[0].lot_id;
                                if (!lotName) {
                                    lotName = blocLotRes.rows[0].lot_name;
                                }
                                console.log('✅ Got lot from bloc\'s ouvrage:', { storedLotId, lotName });
                            }
                        } catch (e) {
                            console.warn('⚠️ Failed to get lot from bloc\'s ouvrage:', e.message);
                        }
                    }

                    console.log('🔍 Creating article addition event with:', {
                        projectId,
                        catalogueId,
                        lotName,
                        lotFromBlocKey: lot,
                        blocName,
                        gblocName
                    });

                    await EventNotificationService.articleAdded(projectId, catalogueId, req.user.id, {
                        nom_article: articleName,
                        nom_bloc: blocName,
                        nom_gbloc: gblocName,
                        quantite: quantity,
                        total_ttc: newArticle.total_ttc || 0,
                        localisation: localisation || null,
                        lot: lotName || null,
                        ...(storedLotId ? { lotId: storedLotId } : {}), // Only pass lotId if we have a value
                        bloc: blocId > 0 ? blocId : null,
                        g_bloc: gblocId
                    });
                    console.log('✅ Article addition event created successfully with lot:', lotName, 'lotId:', storedLotId);
                } catch (eventError) {
                    console.error('❌ Failed to create article addition event:', eventError);
                }
            });
        }

        console.log(`[Add Article] Successfully added article ${catalogueId} to bloc ${blocId}`);

        // DON'T recalculate designations after adding article - we already calculated it correctly
        // Recalculating would overwrite the correct designation with potentially wrong values
        // The designation was already calculated correctly in addCatalogueArticle

        return res.json({ success: true, data: newArticle });
    } catch (e) {
        console.error('[Add Article] Error adding article to bloc:', e);
        console.error('[Add Article] Stack trace:', e.stack);
        return res.status(500).json({
            success: false,
            message: e.message || 'Erreur lors de l\'ajout de l\'article',
            error: process.env.NODE_ENV === 'development' ? e.stack : undefined
        });
    }
});

/**
 * @route   PUT /api/projects/:id/articles/:articleId
 * @desc    Update a project article
 * @access  Private
 */
router.put('/:id/articles/:articleId', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    const articleRowId = parseInt(req.params.articleId, 10); // This is projet_article.id (rowId)

    if (isNaN(projectId) || isNaN(articleRowId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID or article row ID' });
    }

    try {
        // Get the projet_article entry to find the catalogue article ID and bloc/ouvrage info
        const existing = await ProjectArticle.findById(articleRowId);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Article not found' });
        }

        // Validate that article belongs to this project
        // The projet field may come from structure-based lookup, so check multiple sources
        const articleProjectId = existing.projet || existing.id_projet || null;

        // If we can't determine project from the row, verify through structure table
        if (!articleProjectId) {
            // Verify through structure → ouvrage → projet_lot → project
            const structureCheck = await pool.query(`
                SELECT pl.id_projet
                FROM projet_article pa
                INNER JOIN structure s ON s.id_structure = pa.structure
                INNER JOIN ouvrage o ON o.id = s.ouvrage
                INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                WHERE pa.id = $1
            `, [articleRowId]);

            if (structureCheck.rows.length === 0 || structureCheck.rows[0].id_projet !== projectId) {
                return res.status(404).json({ success: false, message: 'Article not found in project' });
            }
        } else if (articleProjectId !== projectId) {
            return res.status(404).json({ success: false, message: 'Article not found in project' });
        }

        // Use Article.updateInProject which creates events - it expects catalogue article ID
        // Pass blocId and gblocId from the specific row for accurate event metadata
        const Article = require('../models/Article');
        const blocId = existing.bloc || null;
        const gblocId = existing.ouvrage || existing.g_bloc || null;
        // Pass the specific projet_article.id to update only that row
        const updatedArticle = await Article.updateInProject(projectId, existing.article, req.body, req.user.id, blocId, gblocId, articleRowId);

        return res.json({ success: true, data: updatedArticle });
    } catch (e) {
        console.error('Error updating article:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   DELETE /api/projects/:id/articles/:articleId
 * @desc    Delete a project article
 * @access  Private
 */
router.delete('/:id/articles/:articleId', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    const articleId = parseInt(req.params.articleId, 10);

    if (isNaN(projectId) || isNaN(articleId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID or article ID' });
    }

    try {
        // Verify article belongs to project
        const existing = await ProjectArticle.findById(articleId);
        if (!existing || existing.projet !== projectId) {
            return res.status(404).json({ success: false, message: 'Article not found' });
        }

        const deletedArticle = await ProjectArticle.deleteOrClear(articleId);

        // ✅ CRITICAL FIX: Recalculate prix_total and pt/pu after deleting article
        // Get article info for recalculation
        const gblocId = existing.g_bloc;
        const blocId = existing.bloc;

        // Recalculate ouvrage prix_total
        if (gblocId) {
            try {
                await Gbloc.recalculatePrixTotal(gblocId, projectId);
                console.log(`✅ Recalculated prix_total for ouvrage ${gblocId} after deleting article`);
            } catch (recalcError) {
                console.error(`❌ Failed to recalculate prix_total for ouvrage ${gblocId}:`, recalcError);
            }
        }

        // Recalculate bloc pt/pu if article belonged to a bloc
        if (blocId) {
            try {
                const totalResult = await pool.query(
                    `SELECT COALESCE(SUM(pa.total_ttc), 0)::float AS total_ttc 
                     FROM projet_article pa
                     INNER JOIN structure s ON s.id_structure = pa.structure
                     INNER JOIN ouvrage o ON o.id = s.ouvrage
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE pl.id_projet = $1 AND s.bloc = $2`,
                    [projectId, blocId]
                );
                const total = totalResult.rows[0]?.total_ttc || 0;
                const quantiteResult = await pool.query('SELECT quantite FROM bloc WHERE id = $1', [blocId]);
                const quantite = Number(quantiteResult.rows[0]?.quantite) || 0;
                const pu = quantite > 0 ? total / quantite : null;
                await pool.query('UPDATE bloc SET pt = $1, pu = $2 WHERE id = $3', [total, pu, blocId]);
                console.log(`✅ Updated bloc ${blocId}: pt=${total}, pu=${pu}`);
            } catch (blocError) {
                console.error(`❌ Failed to update bloc ${blocId} pt/pu:`, blocError);
            }
        }

        // Recalculate project's selling price (prix_vente) after deletion
        try {
            const Project = require('../models/Project');
            await Project.recalculatePrixVente(projectId);
        } catch (recalcError) {
            console.error('Failed to recalculate prix_vente after deleting article:', recalcError);
            // Don't throw - the article was deleted successfully
        }

        // Broadcast real-time update for article deletion
        if (deletedArticle) {
            setImmediate(async () => {
                try {
                    // Get article name
                    const articleResult = await pool.query(
                        'SELECT nom_article FROM articles WHERE "ID" = $1',
                        [existing.article]
                    );
                    const articleName = articleResult.rows[0]?.nom_article || null;

                    // Get bloc name if bloc exists
                    let blocName = null;
                    if (existing.bloc > 0) {
                        const blocResult = await pool.query('SELECT nom_bloc FROM bloc WHERE id = $1', [existing.bloc]);
                        blocName = blocResult.rows[0]?.nom_bloc || null;
                    }

                    // Get ouvrage name
                    let gblocName = null;
                    if (existing.g_bloc) {
                        const ouvrageResult = await pool.query('SELECT nom_ouvrage FROM ouvrage WHERE id = $1', [existing.g_bloc]);
                        gblocName = ouvrageResult.rows[0]?.nom_ouvrage || null;
                    }

                    // Get lot name
                    let lotName = null;
                    if (existing.lot) {
                        try {
                            const lotResult = await pool.query('SELECT niveau_2 FROM niveau_2 WHERE id_niveau_2 = $1', [existing.lot]);
                            lotName = lotResult.rows[0]?.niveau_2 || null;
                        } catch (e) {
                            console.warn('⚠️ Failed to fetch lot name:', e.message);
                        }
                    }

                    await EventNotificationService.articleDeleted(projectId, existing.article, req.user.id, {
                        nom_article: articleName,
                        nom_bloc: blocName,
                        nom_gbloc: gblocName,
                        lot: lotName || existing.lot,
                        bloc: existing.bloc > 0 ? existing.bloc : null,
                        g_bloc: existing.g_bloc
                    });
                } catch (eventError) {
                    console.error('❌ Failed to create article deletion event:', eventError);
                }
            });
        }

        return res.json({ success: true, data: deletedArticle });
    } catch (e) {
        console.error('Error deleting article:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   GET /api/projects/:id/catalogue/search
 * @desc    Search catalogue articles for adding to project
 * @access  Private
 */
router.get('/:id/catalogue/search', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    const {
        searchText,
        niveau2,
        niveau3,
        niveau4,
        page = 1,
        limit = 50
    } = req.query;

    try {
        const result = await ProjectArticle.searchCatalogue({
            searchText,
            niveau2,
            niveau3,
            niveau4,
            page: parseInt(page),
            limit: parseInt(limit)
        });
        return res.json({ success: true, data: result });
    } catch (e) {
        console.error('Error searching catalogue:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   GET /api/projects/:id/details
 * @desc    Get nested project details: lots → ouvrages → blocs → articles
 * @access  Private
 */
router.get('/:id/details', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }
    try {
        const rows = await pool.query(`
            SELECT 
                pa.id,
                pl.id_lot as lot,
                s.ouvrage,
                s.bloc,
                pa.article,
                pa.quantite,
                pa.pu,
                pa.prix_total_ht,
                pa.tva,
                pa.total_ttc,
                pa.designation_article,
                l2.niveau_2 as lot_name,
                o.nom_ouvrage as ouvrage_name,
                b.nom_bloc as bloc_name,
                a."nom_article" as article_name
            FROM projet_article pa
            INNER JOIN structure s ON s.id_structure = pa.structure
            INNER JOIN ouvrage o ON o.id = s.ouvrage
            INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
            LEFT JOIN niveau_2 l2 ON l2.id_niveau_2 = pl.id_lot
            LEFT JOIN bloc b ON b.id = s.bloc
            LEFT JOIN articles a ON a."ID" = pa.article
            WHERE pl.id_projet = $1
            ORDER BY pl.id_lot, s.ouvrage, s.bloc, pa.id
        `, [projectId]);
        const lotsMap = new Map();
        for (const r of rows.rows) {
            const lotKey = r.lot || 'null';
            let lotNode = lotsMap.get(lotKey);
            if (!lotNode) {
                lotNode = { id: r.lot, name: r.lot_name || null, ouvrages: [] };
                lotsMap.set(lotKey, lotNode);
            }
            const ouvrages = lotNode.ouvrages;
            const ouvKey = r.ouvrage || 'null';
            let ouvNode = ouvrages.find(x => (x.id || 'null') === ouvKey);
            if (!ouvNode) {
                ouvNode = { id: r.ouvrage, name: r.ouvrage_name || null, blocs: [], articles: [] };
                ouvrages.push(ouvNode);
            }
            if (r.bloc) {
                let blocNode = ouvNode.blocs.find(x => x.id === r.bloc);
                if (!blocNode) {
                    blocNode = { id: r.bloc, name: r.bloc_name || null, articles: [] };
                    ouvNode.blocs.push(blocNode);
                }
                if (r.article) {
                    blocNode.articles.push({
                        id: r.id,
                        catalogue_id: r.article,
                        name: r.article_name || r.designation_article || null,
                        quantite: r.quantite,
                        pu: r.pu,
                        prix_total_ht: r.prix_total_ht,
                        tva: r.tva,
                        total_ttc: r.total_ttc
                    });
                }
            } else {
                if (r.article) {
                    ouvNode.articles.push({
                        id: r.id,
                        catalogue_id: r.article,
                        name: r.article_name || r.designation_article || null,
                        quantite: r.quantite,
                        pu: r.pu,
                        prix_total_ht: r.prix_total_ht,
                        tva: r.tva,
                        total_ttc: r.total_ttc
                    });
                }
            }
        }
        const lots = Array.from(lotsMap.values());
        return res.json({ success: true, data: { lots } });
    } catch (e) {
        console.error('Error getting project details:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   DELETE /api/projects/:id/gblocs/:gblocKey
 * @desc    Delete a GBloc and all its contents
 * @access  Private
 */
router.delete('/:id/gblocs/:gblocKey', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    const { gblocKey } = req.params;

    try {
        // Parse gblocKey format: lot:gbloc_id (gbloc_id is integer ID, no niv_1 anymore)
        const parts = decodeURIComponent(gblocKey).split(':');
        if (parts.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Invalid gblocKey format. Use: lot:gbloc_id'
            });
        }
        const [lot, gblocIdStr] = parts;
        const gblocId = parseInt(gblocIdStr, 10);

        if (isNaN(gblocId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid gblocKey format. gbloc_id (integer) is required'
            });
        }

        const result = await HierarchyService.deleteGbloc(projectId, {
            lot: lot || null, // lot can be empty string, treat as null
            gbloc_id: gblocId
        }, req.user.id);

        // Broadcast real-time update for gbloc deletion
        if (result) {
            setImmediate(async () => {
                try {
                    // Get ouvrage name
                    const ouvrageResult = await pool.query('SELECT nom_ouvrage FROM ouvrage WHERE id = $1', [gblocId]);
                    const ouvrageName = ouvrageResult.rows[0]?.nom_ouvrage || null;

                    await EventNotificationService.gblocDeleted(projectId, gblocId, req.user.id, {
                        nom_ouvrage: ouvrageName,
                        lot: lot || null
                    });
                } catch (eventError) {
                    console.error('❌ Failed to create gbloc deletion event:', eventError);
                }
            });
        }

        return res.json({ success: true, deleted: result });
    } catch (e) {
        console.error('Error deleting gbloc:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   DELETE /api/projects/:id/blocs/:blocKey
 * @desc    Delete a Bloc and all its articles
 * @access  Private
 */
router.delete('/:id/blocs/:blocKey', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    const { blocKey } = req.params;

    try {
        // Parse blocKey format: lot:gbloc_id:bloc_id (both IDs are integers, no niv_1 anymore)
        const parts = decodeURIComponent(blocKey).split(':');
        if (parts.length < 3) {
            return res.status(400).json({
                success: false,
                message: 'Invalid blocKey format. Use: lot:gbloc_id:bloc_id'
            });
        }
        const [lot, gblocIdStr, blocIdStr] = parts;
        const gblocId = parseInt(gblocIdStr, 10);
        const blocId = parseInt(blocIdStr, 10);

        if (isNaN(gblocId) || isNaN(blocId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid blocKey format. gbloc_id (integer) and bloc_id (integer) are required'
            });
        }

        const result = await HierarchyService.deleteBloc(projectId, {
            lot: lot || null, // lot can be empty string, treat as null
            gbloc_id: gblocId,
            bloc_id: blocId
        }, req.user.id);

        // Broadcast real-time update for bloc deletion
        if (result) {
            setImmediate(async () => {
                try {
                    // Get bloc name
                    const blocResult = await pool.query('SELECT nom_bloc FROM bloc WHERE id = $1', [blocId]);
                    const blocName = blocResult.rows[0]?.nom_bloc || null;

                    // Get ouvrage name
                    const ouvrageResult = await pool.query('SELECT nom_ouvrage FROM ouvrage WHERE id = $1', [gblocId]);
                    const ouvrageName = ouvrageResult.rows[0]?.nom_ouvrage || null;

                    // Get lot name
                    let lotName = null;
                    try {
                        const lotResult = await pool.query('SELECT niveau_2 FROM niveau_2 WHERE id_niveau_2 = $1', [lot]);
                        lotName = lotResult.rows[0]?.niveau_2 || null;
                    } catch (e) {
                        console.warn('⚠️ Failed to fetch lot name:', e.message);
                    }

                    await EventNotificationService.blocDeleted(projectId, blocId, req.user.id, {
                        nom_bloc: blocName,
                        nom_gbloc: ouvrageName,
                        lot: lotName || lot
                    });
                } catch (eventError) {
                    console.error('❌ Failed to create bloc deletion event:', eventError);
                }
            });
        }

        return res.json({ success: true, deleted: result });
    } catch (e) {
        console.error('Error deleting bloc:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== LEGACY GBLOCS ROUTES (kept for backward compatibility) ====================

/**
 * @route   POST /api/projects/:id/gblocs/legacy
 * @desc    Create a grand bloc (gbloc) under a project (legacy method)
 * @access  Private
 */
router.post('/:id/gblocs/legacy', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }
    const { nom_bloc } = req.body || {};
    if (!nom_bloc || String(nom_bloc).trim() === '') {
        return res.status(400).json({ success: false, message: 'nom_bloc is required' });
    }

    try {
        const data = await Project.createGbloc(projectId, req.body, req.user.id, !!req.user.is_admin);

        // Recalculate designations after creating gbloc
        await DesignationHelper.recalculateProjectDesignations(projectId);

        return res.json({ success: true, data });
    } catch (e) {
        console.error('Create g_bloc failed:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   GET /api/projects/:id/real-time-total
 * @desc    Get real-time total TTC from projet_article table
 * @access  Private
 */
router.get('/:id/real-time-total', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    try {
        const client = await pool.connect();
        try {
            // Verify access
            const accessCheckSql = !!req.user.is_admin
                ? 'SELECT id FROM projets WHERE id = $1'
                : `SELECT p.id FROM projets p LEFT JOIN projet_equipe pe ON pe.projet = p.id AND pe.equipe = $2
                   WHERE p.id = $1 AND (p."Ajouté_par" = $2 OR pe.id IS NOT NULL)`;
            const accessArgs = !!req.user.is_admin ? [projectId] : [projectId, req.user.id];
            const access = await client.query(accessCheckSql, accessArgs);
            if (access.rows.length === 0) {
                return res.status(403).json({ success: false, message: 'Project not found or access denied' });
            }

            // Get sum of all total_ttc from projet_article table for this project
            const result = await client.query(
                `SELECT COALESCE(SUM(pa.total_ttc), 0) AS total_ttc 
                 FROM projet_article pa 
                 INNER JOIN structure s ON s.id_structure = pa.structure
                 INNER JOIN ouvrage o ON o.id = s.ouvrage
                 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 WHERE pl.id_projet = $1`,
                [projectId]
            );

            return res.json({
                success: true,
                data: {
                    total_ttc: Number(result.rows[0].total_ttc) || 0
                }
            });
        } finally {
            client.release();
        }
    } catch (e) {
        console.error('Error getting real-time project total:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   PUT /api/projects/:id/gblocs/:gblocId
 * @desc    Update a gbloc (name) and refresh its total
 * @access  Private
 */
router.put('/:id/gblocs/:gblocId', authMiddleware, projectController.updateGbloc);

// ==================== BLOCS ROUTES ====================

/**
 * @route   POST /api/projects/:id/blocs
 * @desc    Create a bloc under a project
 * @access  Private
 */
router.post('/:id/blocs', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    try {
        const client = await pool.connect();
        try {
            // ✅ VALIDATION DES DONNÉES : Validation complète des données de bloc
            const validation = await validateBlocData(client, projectId, req.body);

            if (!validation.isValid) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation échouée',
                    errors: validation.errors
                });
            }

            // Utiliser les données validées
            const validatedData = { ...req.body };
            if (validation.validatedData.nom_bloc !== undefined) {
                validatedData.nom_bloc = validation.validatedData.nom_bloc;
            }
            if (validation.validatedData.designation !== undefined) {
                validatedData.designation = validation.validatedData.designation;
            }

            const data = await Bloc.create(projectId, validatedData, req.user.id, !!req.user.is_admin);

            // Recalculate designations after creating bloc
            await DesignationHelper.recalculateProjectDesignations(projectId);

            // Broadcast real-time update for bloc creation
            if (data) {
                setImmediate(async () => {
                    try {
                        await EventNotificationService.blocCreated(projectId, data.id, req.user.id, {
                            nom_bloc: validatedData.nom_bloc,
                            designation: validatedData.designation
                        });
                    } catch (eventError) {
                        console.error('❌ Failed to create bloc creation event:', eventError);
                    }
                });
            }

            return res.json({ success: true, data });
        } finally {
            client.release();
        }
    } catch (e) {
        console.error('Create bloc failed:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   GET /api/projects/:id/blocs
 * @desc    List blocs for a project
 * @access  Private
 */
router.get('/:id/blocs', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    try {
        const data = await Project.getBlocs(projectId, req.user.id, !!req.user.is_admin);
        return res.json({ success: true, data });
    } catch (e) {
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   GET /api/projects/:id/blocs-totals
 * @desc    Get total TTC per bloc for a project
 * @access  Private
 */
router.get('/:id/blocs-totals', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    try {
        const data = await Project.getBlocTotals(projectId, req.user.id, !!req.user.is_admin);
        return res.json({ success: true, data });
    } catch (e) {
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   PUT /api/projects/:id/reorder-blocs
 * @desc    Persist front-end bloc/gbloc ordering for a project
 * @access  Private
 */
router.put('/:id/reorder-blocs', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    const { order } = req.body || {};
    if (!Array.isArray(order)) {
        return res.status(400).json({ success: false, message: 'order array is required' });
    }

    try {
        await Project.reorderBlocs(projectId, order, req.user.id, !!req.user.is_admin);
        return res.json({ success: true });
    } catch (e) {
        console.error('Error reordering blocs:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   PUT /api/projects/:id/blocs/:blocId
 * @desc    Update a bloc (name, unite, quantite) and recompute pu/pt
 * @access  Private
 */
router.put('/:id/blocs/:blocId', authMiddleware, projectController.updateBloc);

/**
 * @route   DELETE /api/projects/:id/blocs/:blocId
 * @desc    Delete a bloc or gbloc (automatically detects which one)
 * @access  Private
 */
router.delete('/:id/blocs/:blocId', authMiddleware, projectController.deleteBloc);

/**
 * @route   DELETE /api/projects/:id/lots/:lotName
 * @desc    Delete a lot (all blocs in a lot)
 * @access  Private
 */
router.delete('/:id/lots/:lotName', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    const lotName = decodeURIComponent(req.params.lotName || '');
    const gblocId = req.query.gblocId ? parseInt(req.query.gblocId, 10) : null;

    console.log('\n========== DELETE LOT REQUEST ==========');
    console.log(`projectId: ${projectId}, lotName: "${lotName}", gblocId: ${gblocId}`);

    if (isNaN(projectId) || !lotName || String(lotName).trim() === '') {
        console.log('ERROR: Invalid project ID or lot name');
        return res.status(400).json({ success: false, message: 'Invalid project ID or lot name' });
    }

    const userId = req.user.id;
    const isAdmin = !!req.user.is_admin;
    console.log(`userId: ${userId}, isAdmin: ${isAdmin}`);

    try {
        const result = await Lot.delete(projectId, lotName, userId, gblocId);
        console.log(`Lot.delete returned: ${result}`);
        console.log('========== DELETE LOT COMPLETE ==========\n');

        return res.json({
            success: true,
            data: {
                deleted: result
            },
            message: `Lot "${lotName}" deleted successfully`
        });
    } catch (error) {
        console.error('Error deleting lot:', error);
        console.log('========== DELETE LOT ERROR ==========\n');
        return res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== SINGLE GBLOC & BLOC ROUTES ====================

/**
 * @route   GET /api/projects/:id/gblocs/:gblocId
 * @desc    Get a single GBloc by ID with current prix_total
 * @access  Private
 */
router.get('/:id/gblocs/:gblocId', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    const gblocId = parseInt(req.params.gblocId, 10);

    if (isNaN(projectId) || isNaN(gblocId)) {
        return res.status(400).json({ success: false, message: 'Invalid project or gbloc ID' });
    }

    try {
        // Fetch gbloc data with prix_total
        const gblocQuery = `
            SELECT o.id, o.nom_ouvrage, o.designation, o.prix_total, pl.id_lot as lot_id
            FROM ouvrage o
            INNER JOIN structure s ON s.ouvrage = o.id
            INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
            WHERE pl.id_projet = $1 AND o.id = $2
            GROUP BY o.id, o.nom_ouvrage, o.designation, o.prix_total, pl.id_lot
        `;
        const gblocResult = await pool.query(gblocQuery, [projectId, gblocId]);

        if (gblocResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Ouvrage not found' });
        }

        return res.json({ success: true, data: gblocResult.rows[0] });
    } catch (error) {
        console.error('Error fetching gbloc:', error);
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
});

/**
 * @route   GET /api/projects/:id/blocs/:blocId
 * @desc    Get a single Bloc by ID with current pu
 * @access  Private
 */
router.get('/:id/blocs/:blocId', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    const blocId = parseInt(req.params.blocId, 10);

    if (isNaN(projectId) || isNaN(blocId)) {
        return res.status(400).json({ success: false, message: 'Invalid project or bloc ID' });
    }

    try {
        // Fetch bloc data with pu
        const blocQuery = `
            SELECT b.id, b.nom_bloc, b.unite, b.quantite, b.pu, b.pt, b.designation, b.ouvrage
            FROM bloc b
            INNER JOIN ouvrage o ON o.id = b.ouvrage
            INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
            WHERE pl.id_projet = $1 AND b.id = $2
            GROUP BY b.id, b.nom_bloc, b.unite, b.quantite, b.pu, b.pt, b.designation, b.ouvrage
        `;
        const blocResult = await pool.query(blocQuery, [projectId, blocId]);

        if (blocResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Bloc not found' });
        }

        return res.json({ success: true, data: blocResult.rows[0] });
    } catch (error) {
        console.error('Error fetching bloc:', error);
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
});

// ==================== ARTICLES ROUTES ====================

/**
 * @route   GET /api/projects/:id/blocs/:blocId/articles
 * @desc    List articles for a bloc within a project
 * @access  Private
 */
router.get('/:id/blocs/:blocId/articles', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    const blocId = parseInt(req.params.blocId, 10);
    if (isNaN(projectId) || isNaN(blocId)) {
        return res.status(400).json({ success: false, message: 'Invalid project or bloc ID' });
    }

    try {
        const data = await Project.getBlocArticles(projectId, blocId, req.user.id, !!req.user.is_admin);
        return res.json({ success: true, data });
    } catch (e) {
        console.error('Error loading articles for bloc:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   POST /api/projects/:id/blocs/:blocId/articles
 * @desc    Add an article to a bloc
 * @access  Private
 */
router.post('/:id/blocs/:blocId/articles', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    let blocIdParam = req.params.blocId;

    // Handle composite key (lot:gbloc:bloc)
    let lotId = null;
    let gblocId = null;
    let blocId = 0;

    if (blocIdParam.includes(':')) {
        const parts = decodeURIComponent(blocIdParam).split(':');
        if (parts.length >= 3) {
            lotId = parseInt(parts[0], 10);
            gblocId = parseInt(parts[1], 10);
            blocId = parseInt(parts[2], 10);
        } else {
            // Fallback or error
            return res.status(400).json({ success: false, message: 'Invalid composite key format' });
        }
    } else {
        blocId = parseInt(blocIdParam, 10);
    }

    if (isNaN(projectId) || isNaN(blocId)) {
        return res.status(400).json({ success: false, message: 'Invalid project or bloc ID' });
    }

    const { articleId, designation_lot } = req.body || {};
    if (!articleId || isNaN(parseInt(articleId))) {
        return res.status(400).json({ success: false, message: 'articleId est requis' });
    }

    try {
        // Pass lot and gbloc context if available from composite key
        const articleData = {
            ...req.body,
            lot: lotId,
            g_bloc: gblocId,
            designation_lot // Explicitly pass designation_lot
        };

        const data = await Project.addArticleToBloc(projectId, blocId, articleData, req.user.id, !!req.user.is_admin);

        // DON'T recalculate designations after adding article - we already calculated it correctly
        // Recalculating would overwrite the correct designation with potentially wrong values
        // The designation was already calculated correctly in addArticleToBloc

        // Broadcast real-time update for article addition
        if (data) {
            setImmediate(async () => {
                try {
                    // Get article name
                    const articleResult = await pool.query(
                        'SELECT nom_article FROM articles WHERE "ID" = $1',
                        [articleId]
                    );
                    const articleName = articleResult.rows[0]?.nom_article || null;

                    // Get bloc name if bloc exists
                    let blocName = null;
                    if (blocId > 0) {
                        const blocResult = await pool.query('SELECT nom_bloc FROM bloc WHERE id = $1', [blocId]);
                        blocName = blocResult.rows[0]?.nom_bloc || null;
                    }

                    // Get ouvrage name
                    let gblocName = null;
                    if (gblocId) {
                        const ouvrageResult = await pool.query('SELECT nom_ouvrage FROM ouvrage WHERE id = $1', [gblocId]);
                        gblocName = ouvrageResult.rows[0]?.nom_ouvrage || null;
                    }

                    // Get lot name
                    let lotName = null;
                    if (lotId) {
                        try {
                            const lotResult = await pool.query('SELECT niveau_2 FROM niveau_2 WHERE id_niveau_2 = $1', [lotId]);
                            lotName = lotResult.rows[0]?.niveau_2 || null;
                        } catch (e) {
                            console.warn('⚠️ Failed to fetch lot name:', e.message);
                        }
                    }

                    await EventNotificationService.articleAdded(projectId, articleId, req.user.id, {
                        nom_article: articleName,
                        nom_bloc: blocName,
                        nom_gbloc: gblocName,
                        quantite: data.quantite || 1,
                        total_ttc: data.total_ttc || 0,
                        localisation: data.localisation || null,
                        lot: lotName || lotId,
                        bloc: blocId > 0 ? blocId : null,
                        g_bloc: gblocId
                    });
                } catch (eventError) {
                    console.error('❌ Failed to create article addition event:', eventError);
                }
            });
        }

        return res.json({ success: true, data });
    } catch (e) {
        console.error('Error adding article to bloc:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   PUT /api/projects/:id/blocs/:blocId/articles/:articleId
 * @desc    Update an article in a bloc
 * @access  Private
 */
router.put('/:id/blocs/:blocId/articles/:articleId', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    const blocId = parseInt(req.params.blocId, 10);
    const articleId = parseInt(req.params.articleId, 10);
    if (isNaN(projectId) || isNaN(blocId) || isNaN(articleId)) {
        return res.status(400).json({ success: false, message: 'Invalid IDs' });
    }

    try {
        const data = await Article.updateInProject(projectId, articleId, req.body, req.user.id);

        // Broadcast real-time update for article update
        if (data) {
            setImmediate(async () => {
                try {
                    // Get article context for the event
                    const articleContext = await pool.query(
                        `SELECT pa.article, s.bloc, s.ouvrage as gbloc, pl.id_lot as lot
                         FROM projet_article pa
                         INNER JOIN structure s ON s.id_structure = pa.structure
                         INNER JOIN ouvrage o ON o.id = s.ouvrage
                         INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                         WHERE pa.id = $1 AND pl.id_projet = $2`,
                        [articleId, projectId]
                    );

                    if (articleContext.rows.length > 0) {
                        const { article: catalogArticleId, bloc, gbloc, lot } = articleContext.rows[0];
                        
                        // Get article name
                        const articleResult = await pool.query(
                            'SELECT nom_article FROM articles WHERE "ID" = $1',
                            [catalogArticleId]
                        );
                        const articleName = articleResult.rows[0]?.nom_article || null;

                        // Get bloc name if bloc exists
                        let blocName = null;
                        if (bloc > 0) {
                            const blocResult = await pool.query('SELECT nom_bloc FROM bloc WHERE id = $1', [bloc]);
                            blocName = blocResult.rows[0]?.nom_bloc || null;
                        }

                        // Get ouvrage name
                        let gblocName = null;
                        if (gbloc) {
                            const ouvrageResult = await pool.query('SELECT nom_ouvrage FROM ouvrage WHERE id = $1', [gbloc]);
                            gblocName = ouvrageResult.rows[0]?.nom_ouvrage || null;
                        }

                        // Get lot name
                        let lotName = null;
                        if (lot) {
                            try {
                                const lotResult = await pool.query('SELECT niveau_2 FROM niveau_2 WHERE id_niveau_2 = $1', [lot]);
                                lotName = lotResult.rows[0]?.niveau_2 || null;
                            } catch (e) {
                                console.warn('⚠️ Failed to fetch lot name:', e.message);
                            }
                        }

                        await EventNotificationService.articleUpdated(projectId, catalogArticleId, req.user.id, req.body, bloc, gbloc, lotName);
                    }
                } catch (eventError) {
                    console.error('❌ Failed to create article update event:', eventError);
                }
            });
        }

        return res.json({ success: true, data });
    } catch (e) {
        console.error('Error updating article:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   PUT /api/projects/:id/articles/:articleId
 * @desc    Update an article by articleId (projet_article.id), used for updates from new hierarchy
 * @access  Private
 */
router.put('/:id/articles/:articleId', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    const articleId = parseInt(req.params.articleId, 10);

    console.log('🔍 Article update route called:', { projectId, articleId, body: req.body, userId: req.user.id });

    if (isNaN(projectId) || isNaN(articleId)) {
        return res.status(400).json({ success: false, message: 'Invalid project or article ID' });
    }

    try {
        // articleId here is projet_article.id (rowId from frontend)
        // We need to get the actual article catalog ID and context (bloc, gbloc)
        const articleCheck = await pool.query(
            `SELECT pa.article, pa.id as row_id, s.bloc, s.ouvrage as gbloc
             FROM projet_article pa
             INNER JOIN structure s ON s.id_structure = pa.structure
             INNER JOIN ouvrage o ON o.id = s.ouvrage
             INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
             WHERE pa.id = $1 AND pl.id_projet = $2`,
            [articleId, projectId]
        );

        console.log('🔍 Article context query result:', articleCheck.rows);

        if (articleCheck.rows.length === 0) {
            console.log('❌ Article not found in project');
            return res.status(404).json({ success: false, message: 'Article not found in project' });
        }

        const { article: catalogArticleId, row_id, bloc, gbloc } = articleCheck.rows[0];

        console.log('🔍 Calling Article.updateInProject with:', {
            projectId,
            catalogArticleId,
            updateData: req.body,
            userId: req.user.id,
            bloc,
            gbloc,
            row_id
        });

        // Call Article.updateInProject with the catalog article ID and context
        const data = await Article.updateInProject(
            projectId,
            catalogArticleId,
            req.body,
            req.user.id,
            bloc,
            gbloc,
            row_id
        );

        console.log('✅ Article update successful:', data);

        // Broadcast real-time update for article update
        if (data) {
            setImmediate(async () => {
                try {
                    // Get lot info from structure
                    const lotResult = await pool.query(
                        `SELECT pl.id_lot as lot
                         FROM structure s
                         INNER JOIN ouvrage o ON o.id = s.ouvrage
                         INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                         WHERE s.bloc = $1 AND s.ouvrage = $2 AND pl.id_projet = $3
                         LIMIT 1`,
                        [bloc, gbloc, projectId]
                    );
                    const lotId = lotResult.rows[0]?.lot;

                    // Get article name
                    const articleResult = await pool.query(
                        'SELECT nom_article FROM articles WHERE "ID" = $1',
                        [catalogArticleId]
                    );
                    const articleName = articleResult.rows[0]?.nom_article || null;

                    // Get bloc name if bloc exists
                    let blocName = null;
                    if (bloc > 0) {
                        const blocResult = await pool.query('SELECT nom_bloc FROM bloc WHERE id = $1', [bloc]);
                        blocName = blocResult.rows[0]?.nom_bloc || null;
                    }

                    // Get ouvrage name
                    let gblocName = null;
                    if (gbloc) {
                        const ouvrageResult = await pool.query('SELECT nom_ouvrage FROM ouvrage WHERE id = $1', [gbloc]);
                        gblocName = ouvrageResult.rows[0]?.nom_ouvrage || null;
                    }

                    // Get lot name
                    let lotName = null;
                    if (lotId) {
                        try {
                            const lotNameResult = await pool.query('SELECT niveau_2 FROM niveau_2 WHERE id_niveau_2 = $1', [lotId]);
                            lotName = lotNameResult.rows[0]?.niveau_2 || null;
                        } catch (e) {
                            console.warn('⚠️ Failed to fetch lot name:', e.message);
                        }
                    }

                    await EventNotificationService.articleUpdated(projectId, catalogArticleId, req.user.id, req.body, bloc, gbloc, lotName);
                } catch (eventError) {
                    console.error('❌ Failed to create article update event:', eventError);
                }
            });
        }

        return res.json({ success: true, data });
    } catch (e) {
        console.error('Error updating article:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   DELETE /api/projects/:id/blocs/:blocKey/articles/:articleRowId
 * @desc    Delete an article from a bloc or ouvrage (blocKey = lot:gbloc_id:bloc_id, articleRowId = projet_article.id)
 * @access  Private
 */
router.delete('/:id/blocs/:blocKey/articles/:articleRowId', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    const { blocKey } = req.params;
    const articleRowId = parseInt(req.params.articleRowId, 10);

    if (isNaN(projectId) || isNaN(articleRowId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID or article row ID' });
    }

    try {
        // Parse blocKey to extract ouvrage and bloc context
        const parts = decodeURIComponent(blocKey).split(':');
        if (parts.length < 3) {
            return res.status(400).json({
                success: false,
                message: 'Invalid blocKey format. Use: lot:gbloc_id:bloc_id'
            });
        }
        const [lot, gblocIdStr, blocIdStr] = parts;
        const expectedGblocId = parseInt(gblocIdStr, 10);
        const expectedBlocId = parseInt(blocIdStr, 10);

        // Verify article belongs to project and get ouvrage/bloc/lot info for recalculation
        const articleCheck = await pool.query(
            `SELECT s.ouvrage AS ouvrage, s.bloc AS bloc, pl.id_lot AS lot, pa.total_ttc
             FROM projet_article pa
             INNER JOIN structure s ON s.id_structure = pa.structure
             INNER JOIN ouvrage o ON o.id = s.ouvrage
             INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
             WHERE pa.id = $1 AND pl.id_projet = $2`,
            [articleRowId, projectId]
        );

        if (articleCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Article not found in project' });
        }

        const articleData = articleCheck.rows[0];
        const gblocId = articleData.ouvrage;
        const blocId = articleData.bloc;
        const lotId = articleData.lot; // Get lot before deletion

        // ✅ FIX: Verify that the article belongs to the specified ouvrage and bloc
        // This prevents deleting articles from the wrong ouvrage when duplicates exist
        if (expectedBlocId === 0) {
            // Deleting from ouvrage directly (bloc_id = 0 means bloc should be NULL in DB)
            if (gblocId !== expectedGblocId || blocId !== null) {
                return res.status(400).json({
                    success: false,
                    message: 'Article does not belong to the specified ouvrage'
                });
            }
        } else {
            // Deleting from a bloc - verify both ouvrage and bloc match
            if (gblocId !== expectedGblocId || blocId !== expectedBlocId) {
                return res.status(400).json({
                    success: false,
                    message: 'Article does not belong to the specified ouvrage and bloc'
                });
            }
        }

        // Get article name before deletion for event creation
        const articleNameResult = await pool.query(
            'SELECT a."nom_article" as nom_article FROM articles a INNER JOIN projet_article pa ON pa.article = a."ID" WHERE pa.id = $1',
            [articleRowId]
        );
        const articleName = articleNameResult.rows[0]?.nom_article || null;

        // Delete the projet_article entry
        const deletedArticle = await ProjectArticle.deleteOrClear(articleRowId);

        // Recalculate gbloc total if article belonged to a gbloc
        if (gblocId) {
            await Gbloc.recalculatePrixTotal(gblocId, projectId);
        }

        // Recalculate bloc pt/pu if article belonged to a bloc
        if (blocId) {
            const totalResult = await pool.query(
                `SELECT COALESCE(SUM(pa.total_ttc), 0)::float AS total_ttc 
                 FROM projet_article pa
                 INNER JOIN structure s ON s.id_structure = pa.structure
                 INNER JOIN ouvrage o ON o.id = s.ouvrage
                 INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 WHERE pl.id_projet = $1 AND s.bloc = $2`,
                [projectId, blocId]
            );
            const total = totalResult.rows[0]?.total_ttc || 0;
            const quantiteResult = await pool.query('SELECT quantite FROM bloc WHERE id = $1', [blocId]);
            const quantite = Number(quantiteResult.rows[0]?.quantite) || 0;
            const pu = quantite > 0 ? total / quantite : null;
            await pool.query('UPDATE bloc SET pt = $1, pu = $2 WHERE id = $3', [total, pu, blocId]);
        }

        // If article was deleted from ouvrage (no bloc), recalculate bloc designations
        // This ensures blocs are renumbered after articles in ouvrage
        if (!blocId && gblocId) {
            try {
                const DesignationHelper = require('../utils/designationHelper');
                // Get ouvrage designation
                const ouvrageResult = await pool.query('SELECT designation FROM ouvrage WHERE id = $1', [gblocId]);
                const ouvrageDesignation = ouvrageResult.rows[0]?.designation || null;

                if (ouvrageDesignation) {
                    // Get lot ID if available
                    // The lot column in projet_article is already the lot ID (FK to niveau_2.id_niveau_2)
                    const lotResult = await pool.query(
                        `SELECT DISTINCT pl.id_lot AS lot
                         FROM ouvrage o
                         INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                         WHERE pl.id_projet = $1 AND o.id = $2
                         LIMIT 1`,
                        [projectId, gblocId]
                    );
                    // lot column already contains the lot ID (niveau_2.id_niveau_2), not a name
                    const lotId = lotResult.rows[0]?.lot || null;

                    // Recalculate designations for this ouvrage
                    await DesignationHelper.recalculateProjectDesignations(
                        projectId,
                        null, // Use new connection
                        ouvrageDesignation,
                        gblocId,
                        lotId
                    );
                }
            } catch (recalcError) {
                console.error('Failed to recalculate bloc designations after deleting article from ouvrage:', recalcError);
                // Don't throw - the article was deleted successfully
            }
        }

        // Recalculate project's selling price (prix_vente) after deletion
        // This recalculates based on ALL remaining projet_article rows for the project
        // Note: ProjectArticle.delete already recalculates inside its transaction,
        // but we also recalculate here to ensure consistency (event will also recalculate)
        try {
            const Project = require('../models/Project');
            await Project.recalculatePrixVente(projectId);
            console.log(`✅ Recalculated prix_vente in route handler after deleting article (articleRowId: ${articleRowId}, projectId: ${projectId})`);
        } catch (recalcError) {
            console.error('❌ Failed to recalculate prix_vente after deleting article:', recalcError);
            // Don't throw - the article was deleted successfully
        }

        // Create deletion event after successful deletion
        if (deletedArticle && articleName) {
            setImmediate(async () => {
                try {
                    // Get lot name if lotId exists
                    let lotName = null;
                    if (lotId) {
                        try {
                            // Try niveau_2 first (most common), then Niveau_2__lot as fallback
                            let lotResult;
                            try {
                                lotResult = await pool.query('SELECT niveau_2 FROM niveau_2 WHERE id_niveau_2 = $1', [lotId]);
                                lotName = lotResult.rows[0]?.niveau_2 || null;
                            } catch (e1) {
                                // Fallback to Niveau_2__lot if niveau_2 doesn't exist
                                try {
                                    lotResult = await pool.query('SELECT "Niveau_2__lot" FROM niveau_2 WHERE id_niveau_2 = $1', [lotId]);
                                    lotName = lotResult.rows[0]?.Niveau_2__lot || null;
                                } catch (e2) {
                                    console.error('❌ Both column names failed:', e1.message, e2.message);
                                }
                            }
                            console.log('🔍 Fetched lot name for deletion event:', { lotId, lotName });
                        } catch (lotError) {
                            console.error('❌ Failed to fetch lot name for event:', lotError.message, lotError);
                        }
                    } else {
                        console.log('⚠️ lotId is null or undefined, cannot fetch lot name');
                    }
                    await EventNotificationService.articleDeleted(projectId, articleData.article || null, req.user.id, articleName, blocId, gblocId, lotName);
                    console.log('✅ Article deletion event created successfully');
                } catch (eventError) {
                    console.error('❌ Failed to create article deletion event:', eventError);
                }
            });
        }

        return res.json({ success: true, data: { deleted: deletedArticle } });
    } catch (e) {
        console.error('Error deleting article:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== DUPLICATION ROUTES ====================

/**
 * @route   POST /api/projects/:id/gblocs/:gblocId/duplicate
 * @desc    Duplicate an entire gbloc with all its blocs and articles
 * @access  Private
 */
router.post('/:id/gblocs/:gblocId/duplicate', authMiddleware, projectController.duplicateGbloc);

// Bloc duplication removed - only ouvrage duplication is allowed

/**
 * @route   POST /api/projects/:id/lots/:lotId/blocs
 * @desc    Create a bloc under an existing lot
 * @access  Private
 */
router.post('/:id/lots/:lotId/blocs', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    const lotId = parseInt(req.params.lotId, 10);

    if (isNaN(projectId) || isNaN(lotId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID or lot ID' });
    }

    const { nom_bloc, unite, quantite, lotName, gblocId } = req.body || {};
    if (!nom_bloc || String(nom_bloc).trim() === '') {
        return res.status(400).json({ success: false, message: 'nom_bloc is required' });
    }

    try {
        // Create the bloc
        const data = await Bloc.create(projectId, req.body, req.user.id, !!req.user.is_admin);

        // Associate the bloc with the existing lot in projet_article
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('SAVEPOINT sp_pa');
            const paIdCheck = await client.query(`
                SELECT column_default FROM information_schema.columns
                WHERE table_name = 'projet_article' AND column_name = 'id'
            `);

            // Use the lotName and gblocId if provided, otherwise try to find them
            let finalLotName = lotName;
            let finalGblocId = gblocId;

            if (!finalLotName || !finalGblocId) {
                // Try to find the most recent lot with an ouvrage association
                const lotInfo = await client.query(
                    `SELECT DISTINCT pl.id_lot as lot, s.ouvrage 
                     FROM projet_article pa
                     INNER JOIN structure s ON s.id_structure = pa.structure
                     INNER JOIN ouvrage o ON o.id = s.ouvrage
                     INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                     WHERE pl.id_projet = $1 
                     AND pl.id_lot IS NOT NULL
                     AND s.ouvrage IS NOT NULL
                     ORDER BY pa.id DESC
                     LIMIT 1`,
                    [projectId]
                );

                if (lotInfo.rows.length > 0) {
                    finalLotName = lotInfo.rows[0].lot;
                    finalGblocId = lotInfo.rows[0].ouvrage;
                }
            }

            // If we have lot information, create the projet_article entry
            if (finalLotName && finalGblocId) {
                if (paIdCheck.rows[0]?.column_default) {
                    await client.query(
                        `INSERT INTO projet_article (projet, bloc, lot, ouvrage, designation_article, designation_lot) VALUES ($1,$2,$3,$4,$5,$6)`,
                        [projectId, data.id, finalLotName, finalGblocId, null, null]
                    );
                } else {
                    const maxPa = await client.query('SELECT COALESCE(MAX(id), 0) AS max_id FROM projet_article');
                    const nextPa = maxPa.rows[0].max_id + 1;
                    await client.query(
                        `INSERT INTO projet_article (id, projet, bloc, lot, ouvrage, designation_article, designation_lot) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                        [nextPa, projectId, data.id, finalLotName, finalGblocId, null, null]
                    );
                }
            }
            await client.query('RELEASE SAVEPOINT sp_pa');
            await client.query('COMMIT');

            // Emit bloc creation event after linking to lot/gbloc to ensure proper context in feed
            try {
                await EventNotificationService.blocCreated(projectId, data.id, req.user.id, {
                    nom_bloc: data.nom_bloc,
                    unite: data.unite,
                    quantite: data.quantite,
                    lot: finalLotName,
                    g_bloc: finalGblocId
                });
            } catch (eventError) {
                console.error('Failed to emit blocCreated event after linking:', eventError);
            }
        } catch (e) {
            try { await client.query('ROLLBACK TO SAVEPOINT sp_pa'); } catch { }
            try { await client.query('ROLLBACK'); } catch { }
            throw e;
        } finally {
            client.release();
        }

        // Recalculate designations after creating bloc under lot
        await DesignationHelper.recalculateProjectDesignations(projectId);

        return res.json({ success: true, data });
    } catch (e) {
        console.error('Create bloc under lot failed:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   POST /api/projects/:id/lots
 * @desc    Create a lot without bloc
 * @access  Private
 */
router.post('/:id/lots', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);

    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    try {
        const data = await Lot.create(projectId, req.body, req.user.id, null);

        // Recalculate designations after creating lot
        await DesignationHelper.recalculateProjectDesignations(projectId);

        return res.json({ success: true, data });
    } catch (e) {
        console.error('Create lot failed:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   PUT /api/projects/:id/lots/:lotId/designation
 * @desc    Update lot designation
 * @access  Private
 */
router.put('/:id/lots/:lotId/designation', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    const lotId = parseInt(req.params.lotId, 10);

    if (isNaN(projectId) || isNaN(lotId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID or lot ID' });
    }

    const { designation } = req.body || {};

    // Allow empty designation to clear/cancel the designation
    if (designation === undefined || designation === null) {
        return res.status(400).json({ success: false, message: 'Designation is required' });
    }

    // Accept empty string to clear the designation
    const trimmedDesignation = typeof designation === 'string' ? designation.trim() : '';

    try {
        const userId = req.user.id;
        const result = await Lot.updateDesignation(projectId, lotId, trimmedDesignation, userId);
        return res.json({ success: true, data: result });
    } catch (e) {
        console.error('Error updating lot designation:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   POST /api/projects/:id/lots/reorder
 * @desc    Reorder lots and update their designations
 * @access  Private
 */
router.post('/:id/lots/reorder', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);

    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    const { lots } = req.body || {};
    if (!Array.isArray(lots) || lots.length === 0) {
        return res.status(400).json({ success: false, message: 'Lots array is required' });
    }

    try {
        const userId = req.user.id;
        const result = await Lot.reorder(projectId, lots, userId);
        return res.json({ success: true, data: result });
    } catch (e) {
        console.error('Error reordering lots:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   POST /api/projects/:id/gblocs/:gblocId/lots
 * @desc    Create a lot under a gbloc
 * @access  Private
 */
router.post('/:id/gblocs/:gblocId/lots', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    const gblocId = parseInt(req.params.gblocId, 10);

    if (isNaN(projectId) || isNaN(gblocId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID or gbloc ID' });
    }

    const { lot, nom_bloc, unite, quantite, designation } = req.body || {};
    if (!lot || String(lot).trim() === '') {
        return res.status(400).json({ success: false, message: 'lot is required' });
    }

    try {
        // Create the lot with gbloc association
        const data = await Project.createLotUnderGbloc(projectId, gblocId, req.body, req.user.id, !!req.user.is_admin);

        // Recalculate designations after creating lot under gbloc
        await DesignationHelper.recalculateProjectDesignations(projectId);

        return res.json({ success: true, data });
    } catch (e) {
        console.error('Create lot under gbloc failed:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

// Lot duplication removed - only ouvrage duplication is allowed

// ==================== DESIGNATION ROUTES ====================


/**
 * @route   POST /api/projects/:id/recalculate-designations
 * @desc    Recalculate all designation numbers for a project's hierarchy
 * @access  Private
 * @body    {number|null} lotId - Optional lot ID for lot-specific recalculation
 * @body    {number|null} targetOuvrageId - Optional ouvrage ID to recalculate
 * @body    {string|null} startingDesignation - Optional starting designation
 */
router.post('/:id/recalculate-designations', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    const { lotId = null, targetOuvrageId = null, startingDesignation = null } = req.body || {};

    try {
        const result = await DesignationHelper.recalculateProjectDesignations(
            projectId,
            null,
            startingDesignation || null,
            targetOuvrageId || null,
            lotId || null
        );
        return res.json({ success: true, ...result });
    } catch (e) {
        console.error('Error recalculating designations:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * @route   GET /api/projects/:id/lot-prices
 * @desc    Get prices for all lots in a project
 * @access  Private
 */
router.get('/:id/lot-prices', authMiddleware, async (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    // 🆕 Add parameter to prevent database updates (frontend manages prices)
    const skipDbUpdate = req.query.skip_update === 'true';

    try {
        // Get all lots with their prix_total and prix_vente from projet_lot table
        const lotPricesQuery = `
            SELECT 
                pl.id_lot,
                pl.id_lot as lot,
                pl.prix_total,
                pl.prix_vente,
                pl.designation_lot
            FROM projet_lot pl
            WHERE pl.id_projet = $1
            ORDER BY pl.id_lot
        `;

        const lotPricesResult = await pool.query(lotPricesQuery, [projectId]);

        // If no prix_total/prix_vente in projet_lot, calculate from ouvrages
        if (lotPricesResult.rows.length === 0 || lotPricesResult.rows.some(row => row.prix_total === null)) {
            // 🚨 Frontend manages prices - skip backend recalculation to prevent loops
            if (skipDbUpdate) {
                console.log(`[LOT-PRICES] Frontend manages prices for project ${projectId} - returning current data without recalculation`);
                // Return current data from database (may be null/empty but that's OK)
                return res.json({
                    success: true,
                    data: lotPricesResult.rows,
                    message: 'Frontend manages prices'
                });
            }
            // Get project data to calculate coefficient
            const projectQuery = `
                SELECT cl.marge_brut, cl.marge_net 
                FROM projets p 
                LEFT JOIN client cl ON cl.id = p.client 
                WHERE p.id = $1
            `;
            const projectResult = await pool.query(projectQuery, [projectId]);

            let coef = 1.2; // Default coefficient
            if (projectResult.rows.length > 0) {
                const mb = Number(projectResult.rows[0].marge_brut ?? 0);
                const mn = Number(projectResult.rows[0].marge_net ?? 0);
                const denom = 1 - (mb / 100) - (mn / 100);
                if (isFinite(denom) && denom > 0) {
                    coef = 1 / denom;
                }
            }

            const calculatedPricesQuery = `
                SELECT 
                    pl.id_lot,
                    pl.id_lot as lot,
                    COALESCE(SUM(o.prix_total), 0) as prix_total,
                    COALESCE(SUM(o.prix_total * $2), 0) as prix_vente
                FROM projet_lot pl
                LEFT JOIN ouvrage o ON o.projet_lot = pl.id_projet_lot
                WHERE pl.id_projet = $1
                GROUP BY pl.id_lot
                ORDER BY pl.id_lot
            `;

            const calculatedResult = await pool.query(calculatedPricesQuery, [projectId, coef]);

            // 🚨 For real-time events (skipDbUpdate=false), return current database prices
            // For frontend operations (skipDbUpdate=true), return calculated prices
            if (!skipDbUpdate) {
                console.log(`[LOT-PRICES] Real-time event - returning current database prices for project ${projectId}`);
                // Return current database prices (don't recalculate)
                const currentPricesQuery = `
                    SELECT 
                        pl.id_lot,
                        pl.id_lot as lot,
                        pl.prix_total,
                        pl.prix_vente,
                        pl.designation_lot
                    FROM projet_lot pl
                    WHERE pl.id_projet = $1
                    ORDER BY pl.id_lot
                `;
                const currentResult = await pool.query(currentPricesQuery, [projectId]);
                return res.json({
                    success: true,
                    data: currentResult.rows
                });
            }

            return res.json({
                success: true,
                data: calculatedResult.rows.map(row => ({
                    id_lot: row.id_lot,
                    lot: row.lot,
                    prix_total: row.prix_total,
                    prix_vente: row.prix_vente,
                    designation_lot: null
                }))
            });
        }

        return res.json({
            success: true,
            data: lotPricesResult.rows.map(row => ({
                id_lot: row.id_lot,
                lot: row.lot,
                prix_total: row.prix_total || 0,
                prix_vente: row.prix_vente || 0,
                designation_lot: row.designation_lot
            }))
        });

    } catch (error) {
        console.error('Error fetching lot prices:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
