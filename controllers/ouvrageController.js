const { Ouvrage, Bloc, Structure, ProjetLot, ProjetArticle, Article, Event, sequelize } = require('../models');
const { generateUniqueId } = require('../utils/idGenerator');

/**
 * Create a new Ouvrage with atomic transaction and structure table handling
 * POST /api/ouvrages
 */
exports.createOuvrage = async (req, res) => {
    const transaction = await sequelize.transaction();

    try {
        const {
            nom_ouvrage,
            designation,
            projet_lot,
            bloc_nom,
            bloc_designation,
            bloc_unite,
            bloc_quantite,
            bloc_pu
        } = req.body;

        // Validate required fields
        if (!nom_ouvrage || !nom_ouvrage.trim()) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                message: 'Le nom de louvrage est obligatoire'
            });
        }

        if (!designation || !designation.trim()) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                message: 'La désignation de louvrage est obligatoire'
            });
        }

        if (!projet_lot) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                message: 'Le lot du projet est obligatoire'
            });
        }

        // Verify projet_lot exists
        const projetLot = await ProjetLot.findByPk(projet_lot, { transaction });
        if (!projetLot) {
            await transaction.rollback();
            return res.status(404).json({
                success: false,
                message: 'Lot de projet non trouvé'
            });
        }

        const nextOuvrageId = await generateUniqueId(transaction);

        const ouvrage = await Ouvrage.create({
            id: nextOuvrageId,
            nom_ouvrage: nom_ouvrage.trim(),
            designation: designation.trim(),
            projet_lot,
            prix_total: 0 // Will be calculated later
        }, { transaction });

        // Create structure table entries
        const structureEntries = [];

        // Always create one structure entry for the ouvrage itself
        const [nextStructureIdResult] = await sequelize.query(
            'SELECT COALESCE(MAX(id_structure), 0) + 1 as next_id FROM structure',
            { transaction }
        );
        let nextStructureId = nextStructureIdResult[0].next_id;

        structureEntries.push({
            id_structure: nextStructureId,
            ouvrage: ouvrage.id,
            bloc: null,
            action: 'ouvrage'
        });

        // If bloc data is provided, create bloc and additional structure entry
        let bloc = null;
        if (bloc_nom && bloc_nom.trim()) {
            // Validate bloc required fields
            if (!bloc_designation || !bloc_designation.trim()) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'La désignation du bloc est obligatoire'
                });
            }

            // Create the bloc
            const nextBlocId = await generateUniqueId(transaction);

            bloc = await Bloc.create({
                id: nextBlocId,
                nom_bloc: bloc_nom.trim(),
                designation: bloc_designation.trim(),
                unite: bloc_unite || null,
                quantite: bloc_quantite || null,
                pu: bloc_pu || null,
                pt: (bloc_quantite && bloc_pu) ? bloc_quantite * bloc_pu : null,
                ouvrage: ouvrage.id
            }, { transaction });

            // Create structure entry for the bloc
            structureEntries.push({
                id_structure: nextStructureId + 1,
                ouvrage: ouvrage.id,
                bloc: bloc.id,
                action: 'bloc'
            });
        }

        // Create all structure entries atomically
        await Structure.bulkCreate(structureEntries, { transaction });

        // Create event log for ouvrage creation
        try {
            const [lotResult] = await sequelize.query(
                'SELECT id_projet, id_lot FROM projet_lot WHERE id_projet_lot = :lotId',
                { replacements: { lotId: projet_lot }, transaction }
            );

            if (lotResult && lotResult[0]) {
                const projectId = lotResult[0].id_projet;
                const lotIdNiveau2 = lotResult[0].id_lot; // This is id_niveau_2
                const userId = req.body.userId || null;

                const [nextEventIdResult] = await sequelize.query(
                    'SELECT COALESCE(MAX(id_event), 0) + 1 as next_id FROM events',
                    { transaction }
                );
                const nextEventId = nextEventIdResult[0].next_id;

                await Event.create({
                    id_event: nextEventId,
                    action: 'ouvrage_ajouter',
                    created_at: new Date(),
                    metadata: { nom_ouvrage, designation },
                    user: userId,
                    ouvrage: ouvrage.id,
                    projet: projectId,
                    lot: lotIdNiveau2
                }, { transaction });
            }
        } catch (eventError) {
            console.error('Error creating event log:', eventError);
            // Don't fail the whole operation if event logging fails
        }

        // Commit the transaction
        await transaction.commit();

        // Return the complete data with associations
        const result = await Ouvrage.findByPk(ouvrage.id, {
            include: [
                {
                    model: Structure,
                    as: 'structures',
                    include: [
                        {
                            model: Bloc,
                            as: 'blocData'
                        }
                    ]
                },
                {
                    model: Bloc,
                    as: 'blocs'
                }
            ]
        });

        res.status(201).json({
            success: true,
            data: result,
            message: 'Ouvrage créé avec succès'
        });

    } catch (error) {
        // Rollback transaction on any error
        await transaction.rollback();

        console.error('Error creating ouvrage with structure:', error);

        // Handle specific Sequelize errors
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({
                success: false,
                message: 'Erreur de validation des données',
                errors: error.errors.map(err => ({
                    field: err.path,
                    message: err.message
                }))
            });
        }

        if (error.name === 'SequelizeForeignKeyConstraintError') {
            return res.status(400).json({
                success: false,
                message: 'Erreur de contrainte de clé étrangère',
                error: error.message
            });
        }

        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: error.message
        });
    }
};

/**
 * Update an Ouvrage
 * PUT /api/ouvrages/:id
 */
exports.updateOuvrage = async (req, res) => {
    try {
        const { id } = req.params;
        const ouvrage = await Ouvrage.findByPk(id);

        if (!ouvrage) {
            return res.status(404).json({
                success: false,
                message: 'Ouvrage not found'
            });
        }

        const oldOuvrageData = ouvrage.toJSON();
        await ouvrage.update(req.body);

        // Create event log for ouvrage modification
        try {
            const [lotResult] = await sequelize.query(
                'SELECT id_projet, id_lot FROM projet_lot WHERE id_projet_lot = :lotId',
                { replacements: { lotId: ouvrage.projet_lot } }
            );

            if (lotResult && lotResult[0]) {
                const projectId = lotResult[0].id_projet;
                const lotIdNiveau2 = lotResult[0].id_lot;
                const userId = req.body.userId || null;

                const [nextEventIdResult] = await sequelize.query(
                    'SELECT COALESCE(MAX(id_event), 0) + 1 as next_id FROM events'
                );
                const nextEventId = nextEventIdResult[0].next_id;

                const changes = {};
                if (req.body.nom_ouvrage && req.body.nom_ouvrage !== oldOuvrageData.nom_ouvrage) {
                    changes.nom_ouvrage = { old: oldOuvrageData.nom_ouvrage, new: req.body.nom_ouvrage };
                }
                if (req.body.designation && req.body.designation !== oldOuvrageData.designation) {
                    changes.designation = { old: oldOuvrageData.designation, new: req.body.designation };
                }

                await Event.create({
                    id_event: nextEventId,
                    action: 'ouvrage_modifier',
                    created_at: new Date(),
                    metadata: changes,
                    user: userId,
                    ouvrage: ouvrage.id,
                    ouvrage_nom_anc: oldOuvrageData.nom_ouvrage,
                    projet: projectId,
                    lot: lotIdNiveau2
                });
            }
        } catch (eventError) {
            console.error('Error creating event log:', eventError);
            // Don't fail the whole operation if event logging fails
        }

        res.status(200).json({
            success: true,
            data: ouvrage
        });
    } catch (error) {
        console.error('Error updating ouvrage:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating ouvrage',
            error: error.message
        });
    }
};

/**
 * Delete an Ouvrage
 * DELETE /api/ouvrages/:id
 */
exports.deleteOuvrage = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const { id } = req.params;
        const ouvrage = await Ouvrage.findByPk(id);

        if (!ouvrage) {
            await transaction.rollback();
            return res.status(404).json({
                success: false,
                message: 'Ouvrage not found'
            });
        }

        await sequelize.query(
            `
            DELETE FROM projet_article 
            WHERE structure IN (
                SELECT id_structure FROM structure 
                WHERE ouvrage = :ouvrageId 
                   OR bloc IN (SELECT id FROM bloc WHERE ouvrage = :ouvrageId)
            )
            `,
            { transaction, replacements: { ouvrageId: id } }
        );

        await sequelize.query(
            `
            DELETE FROM structure 
            WHERE ouvrage = :ouvrageId 
               OR bloc IN (SELECT id FROM bloc WHERE ouvrage = :ouvrageId)
            `,
            { transaction, replacements: { ouvrageId: id } }
        );

        await sequelize.query(
            `DELETE FROM bloc WHERE ouvrage = :ouvrageId`,
            { transaction, replacements: { ouvrageId: id } }
        );

        // Create event log before deletion
        try {
            const [lotResult] = await sequelize.query(
                'SELECT id_projet, id_lot FROM projet_lot WHERE id_projet_lot = :lotId',
                { replacements: { lotId: ouvrage.projet_lot }, transaction }
            );

            if (lotResult && lotResult[0]) {
                const projectId = lotResult[0].id_projet;
                const lotIdNiveau2 = lotResult[0].id_lot;
                const userId = req.body.userId || null;

                const [nextEventIdResult] = await sequelize.query(
                    'SELECT COALESCE(MAX(id_event), 0) + 1 as next_id FROM events',
                    { transaction }
                );
                const nextEventId = nextEventIdResult[0].next_id;

                await Event.create({
                    id_event: nextEventId,
                    action: 'ouvrage_supprimer',
                    created_at: new Date(),
                    metadata: { nom_ouvrage: ouvrage.nom_ouvrage, designation: ouvrage.designation },
                    user: userId,
                    ouvrage_nom_anc: ouvrage.nom_ouvrage,
                    projet: projectId,
                    lot: lotIdNiveau2
                    // NOTE: Don't include 'ouvrage' field to avoid FK constraint
                }, { transaction });
            }
        } catch (eventError) {
            console.error('Error creating event log:', eventError);
            // Don't fail the whole operation if event logging fails
        }

        // Set ouvrage to NULL in existing events to avoid foreign key constraint violation
        await sequelize.query(
            `UPDATE events SET ouvrage = NULL WHERE ouvrage = :ouvrageId`,
            { transaction, replacements: { ouvrageId: id } }
        );

        await ouvrage.destroy({ transaction });
        await transaction.commit();

        res.status(200).json({
            success: true,
            message: 'Ouvrage deleted successfully'
        });
    } catch (error) {
        await transaction.rollback();
        console.error('Error deleting ouvrage:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting ouvrage',
            error: error.message
        });
    }
};

exports.createProjetArticle = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        console.log('=== createProjetArticle called ===');
        console.log('Request body:', JSON.stringify(req.body, null, 2));

        const { parent_type, parent_id, structure_id, items } = req.body;

        console.log('Validating parent_type:', parent_type);
        if (!parent_type || !['ouvrage', 'bloc'].includes(parent_type)) {
            await transaction.rollback();
            return res.status(400).json({ success: false, message: 'parent_type invalide' });
        }

        console.log('Validating parent_id:', parent_id);
        if (!parent_id) {
            await transaction.rollback();
            return res.status(400).json({ success: false, message: 'parent_id manquant' });
        }

        let parentOuvrageId = null;
        let blocId = null;
        if (parent_type === 'ouvrage') {
            console.log('Looking for ouvrage with id:', parent_id);
            const ov = await Ouvrage.findByPk(parent_id, { transaction });
            if (!ov) {
                await transaction.rollback();
                return res.status(404).json({ success: false, message: 'Ouvrage introuvable' });
            }
            parentOuvrageId = ov.id;
            console.log('Found ouvrage, parentOuvrageId:', parentOuvrageId);
        } else {
            console.log('Looking for bloc with id:', parent_id);
            const bl = await Bloc.findByPk(parent_id, { transaction });
            if (!bl) {
                await transaction.rollback();
                return res.status(404).json({ success: false, message: 'Bloc introuvable' });
            }
            parentOuvrageId = bl.ouvrage;
            blocId = bl.id;
            console.log('Found bloc, parentOuvrageId:', parentOuvrageId, 'blocId:', blocId);
        }

        console.log('Looking for structure with ouvrage:', parentOuvrageId, 'bloc:', blocId);
        let structureId = structure_id || null;
        if (!structureId) {
            const existingStruct = await Structure.findOne({
                where: { ouvrage: parentOuvrageId, bloc: blocId },
                transaction
            });
            if (existingStruct) {
                structureId = existingStruct.id_structure;
                console.log('Found existing structure:', structureId);
            } else {
                console.log('Creating new structure entry');
                const [nextStructureIdResult] = await sequelize.query(
                    'SELECT COALESCE(MAX(id_structure), 0) + 1 as next_id FROM structure',
                    { transaction }
                );
                structureId = nextStructureIdResult[0].next_id;
                console.log('New structure id:', structureId);
                await Structure.create({
                    id_structure: structureId,
                    ouvrage: parentOuvrageId,
                    bloc: blocId,
                    action: blocId ? 'bloc' : 'ouvrage'
                }, { transaction });
                console.log('Structure created successfully');
            }
        }

        const payloadItems = Array.isArray(items) ? items : (items ? [items] : []);
        console.log('Processing', payloadItems.length, 'items');
        if (payloadItems.length === 0) {
            await transaction.rollback();
            return res.status(400).json({ success: false, message: 'Aucun article à créer' });
        }

        const created = [];
        const skipped = [];
        for (const it of payloadItems) {
            // Check if this article already exists in this structure
            const articleId = it.article ?? null;
            if (articleId) {
                const existingArticle = await ProjetArticle.findOne({
                    where: {
                        structure: structureId,
                        article: articleId
                    },
                    transaction
                });

                if (existingArticle) {
                    console.log(`Article ${articleId} already exists in structure ${structureId}, skipping`);
                    skipped.push({ article: articleId, reason: 'Article déjà ajouté à cet ouvrage/bloc' });
                    continue;
                }
            }

            const [nextArticleIdResult] = await sequelize.query(
                'SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM projet_article',
                { transaction }
            );
            const nextProjArtId = nextArticleIdResult[0].next_id;
            const quantite = it.quantity ?? it.quantite ?? null;
            const unitPrice = it.unitPrice ?? it.nouv_prix ?? null;
            const prixHt = it.prix_total_ht ?? (quantite && unitPrice ? Number(quantite) * Number(unitPrice) : null);
            const tva = it.tva ?? 0;
            const totalTtc = it.total_ttc ?? (prixHt != null ? Number(prixHt) * (1 + Number(tva) / 100) : null);

            const pa = await ProjetArticle.create({
                id: nextProjArtId,
                article: it.article ?? null,
                quantite: quantite ?? null,
                prix_total_ht: prixHt ?? null,
                tva: tva ?? null,
                total_ttc: totalTtc ?? null,
                localisation: it.localisation ?? null,
                description: it.description ?? null,
                nouv_prix: unitPrice ?? null,
                designation_article: it.designation ?? it.designation_article ?? null,
                structure: structureId
            }, { transaction });
            created.push(pa);
        }

        // If articles were added to a bloc, update the bloc's PU (PU = PT / Quantité)
        if (blocId) {
            const bloc = await Bloc.findByPk(blocId, { transaction });
            if (bloc && bloc.quantite && bloc.quantite > 0) {
                // Calculate total PT from all articles in this bloc
                const allArticles = await ProjetArticle.findAll({
                    where: { structure: structureId },
                    transaction
                });
                const totalPT = allArticles.reduce((sum, article) => sum + (article.total_ttc || 0), 0);
                const newPU = totalPT / bloc.quantite;

                await bloc.update({
                    pu: newPU,
                    pt: totalPT
                }, { transaction });
            }
        }

        // Create event log for article creation
        try {
            const ouvrage = await Ouvrage.findByPk(parentOuvrageId, { transaction });
            if (ouvrage && ouvrage.projet_lot) {
                const [lotResult] = await sequelize.query(
                    'SELECT id_projet, id_lot FROM projet_lot WHERE id_projet_lot = :lotId',
                    { replacements: { lotId: ouvrage.projet_lot }, transaction }
                );

                if (lotResult && lotResult[0]) {
                    const projectId = lotResult[0].id_projet;
                    const lotIdNiveau2 = lotResult[0].id_lot;
                    const userId = req.body.userId || null;

                    for (const article of created) {
                        const [nextEventIdResult] = await sequelize.query(
                            'SELECT COALESCE(MAX(id_event), 0) + 1 as next_id FROM events',
                            { transaction }
                        );
                        const nextEventId = nextEventIdResult[0].next_id;

                        await Event.create({
                            id_event: nextEventId,
                            action: 'projet_article_ajouter',
                            created_at: new Date(),
                            metadata: {
                                designation: article.designation_article,
                                quantite: article.quantite,
                                nouv_prix: article.nouv_prix
                            },
                            user: userId,
                            article: article.article, // Use catalog article ID
                            ouvrage: parentOuvrageId,
                            bloc: blocId,
                            projet: projectId,
                            lot: lotIdNiveau2
                        }, { transaction });
                    }
                }
            }
        } catch (eventError) {
            console.error('Error creating event log:', eventError);
            // Don't fail the whole operation if event logging fails
        }

        await transaction.commit();

        const result = await ProjetArticle.findAll({
            where: { structure: structureId },
            include: [
                { model: Article, as: 'articleData' }
            ]
        });


        // Recalculate ouvrage and lot prices after adding articles
        try {
            console.log('=== Attempting to recalculate ouvrage and lot prices ===');
            console.log('parentOuvrageId:', parentOuvrageId);
            const ouvrage = await Ouvrage.findByPk(parentOuvrageId);
            console.log('Found ouvrage:', ouvrage ? `ID=${ouvrage.id}, projet_lot=${ouvrage.projet_lot}` : 'null');

            if (ouvrage) {
                // STEP 1: Recalculate ouvrage's prix_total from its articles
                console.log(`Step 1: Calculating prix_total for ouvrage ${ouvrage.id}`);
                const ouvrageStructures = await Structure.findAll({
                    where: { ouvrage: ouvrage.id }
                });

                const structureIds = ouvrageStructures.map(s => s.id_structure);
                const ouvrageArticles = await ProjetArticle.findAll({
                    where: { structure: structureIds }
                });

                const ouvragePrixTotal = ouvrageArticles.reduce((sum, art) => sum + (art.total_ttc || 0), 0);
                console.log(`Calculated prix_total for ouvrage ${ouvrage.id}: ${ouvragePrixTotal}`);

                await ouvrage.update({ prix_total: ouvragePrixTotal });
                console.log(`Updated ouvrage ${ouvrage.id} prix_total in database`);

                // STEP 2: Recalculate lot prices if ouvrage belongs to a lot
                if (ouvrage.projet_lot) {
                    console.log(`Step 2: Recalculating prices for lot ${ouvrage.projet_lot}`);
                    const lotController = require('./lotController');
                    const result = await lotController.recalculateLotPrices(ouvrage.projet_lot);
                    console.log('Lot prices updated:', result);
                } else {
                    console.log('Ouvrage has no projet_lot, skipping lot recalculation');
                }
            } else {
                console.log('Ouvrage not found, skipping price recalculation');
            }
        } catch (error) {
            console.error('Error recalculating ouvrage/lot prices:', error);
            console.error('Error stack:', error.stack);
            // Don't fail the whole operation if recalculation fails
        }

        res.status(201).json({
            success: true,
            data: { structure_id: structureId, articles: result },
            ...(skipped.length > 0 && {
                warning: `${skipped.length} article(s) ignoré(s) car déjà présent(s)`,
                skipped
            })
        });
    } catch (error) {
        // Only rollback if transaction is still active
        if (transaction && !transaction.finished) {
            await transaction.rollback();
        }
        console.error('Error creating projet articles:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: error.message
        });
    }
};

/**
 * Get catalog of articles linked to the parent's lot (niveau_2)
 * GET /api/projet-details/articles/catalog?parent_type=ouvrage|bloc&parent_id=ID
 */
exports.getArticlesCatalogForParent = async (req, res) => {
    try {
        const { parent_type, parent_id } = req.query;
        if (!parent_type || !['ouvrage', 'bloc'].includes(parent_type)) {
            return res.status(400).json({ success: false, message: 'parent_type invalide' });
        }
        if (!parent_id) {
            return res.status(400).json({ success: false, message: 'parent_id manquant' });
        }

        let projetLotId = null;
        if (parent_type === 'ouvrage') {
            const ov = await Ouvrage.findByPk(parent_id);
            if (!ov) return res.status(404).json({ success: false, message: 'Ouvrage introuvable' });
            projetLotId = ov.projet_lot;
        } else {
            const bl = await Bloc.findByPk(parent_id);
            if (!bl) return res.status(404).json({ success: false, message: 'Bloc introuvable' });
            const ov = await Ouvrage.findByPk(bl.ouvrage);
            if (!ov) return res.status(404).json({ success: false, message: 'Ouvrage parent introuvable' });
            projetLotId = ov.projet_lot;
        }

        const lot = await ProjetLot.findByPk(projetLotId);
        if (!lot) {
            return res.status(404).json({ success: false, message: 'Lot du projet introuvable' });
        }

        const lotNiv2Id = lot.id_lot;
        const [rows] = await sequelize.query(`
            SELECT a."ID" as id, a."nom_article", a."Date", a."Unite", a."PU"
            FROM articles a
            JOIN niveau_6 n6 ON a."id_niv_6" = n6."id_niveau_6"
            JOIN niveau_3 n3 ON n6."id_niv_3" = n3."id_niveau_3"
            JOIN niveau_2 n2 ON n3."id_niv_2" = n2."id_niveau_2"
            WHERE n2."id_niveau_2" = :niv2Id
            ORDER BY a."nom_article" ASC, a."Date" DESC
        `, {
            replacements: { niv2Id: lotNiv2Id }
        });

        return res.status(200).json({
            success: true,
            data: rows
        });
    } catch (error) {
        console.error('Error fetching articles catalog for parent:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: error.message
        });
    }
};

exports.updateProjetArticle = async (req, res) => {
    try {
        const { id } = req.params;
        const pa = await ProjetArticle.findByPk(id);
        if (!pa) {
            return res.status(404).json({
                success: false,
                message: 'ProjetArticle not found'
            });
        }

        const { description, localisation, quantite, nouv_prix, tva, designation_article } = req.body || {};

        const oldArticleData = pa.toJSON();
        const nextQuantite = quantite != null ? Number(quantite) : pa.quantite;
        const nextPu = nouv_prix != null ? Number(nouv_prix) : pa.nouv_prix;
        const nextTva = tva != null ? Number(tva) : (pa.tva || 0);

        const prix_total_ht = (nextQuantite != null && nextPu != null)
            ? Number(nextQuantite) * Number(nextPu)
            : pa.prix_total_ht;
        const total_ttc = (prix_total_ht != null)
            ? Number(prix_total_ht) * (1 + Number(nextTva) / 100)
            : pa.total_ttc;

        await pa.update({
            description: description != null ? description : pa.description,
            localisation: localisation != null ? localisation : pa.localisation,
            quantite: nextQuantite,
            nouv_prix: nextPu,
            tva: nextTva,
            prix_total_ht,
            total_ttc,
            designation_article: designation_article != null ? designation_article : pa.designation_article
        });

        // Create event log for article modification
        try {
            const structure = await Structure.findByPk(pa.structure);
            if (structure) {
                const ouvrage = await Ouvrage.findByPk(structure.ouvrage);
                if (ouvrage && ouvrage.projet_lot) {
                    const [lotResult] = await sequelize.query(
                        'SELECT id_projet, id_lot FROM projet_lot WHERE id_projet_lot = :lotId',
                        { replacements: { lotId: ouvrage.projet_lot } }
                    );

                    if (lotResult && lotResult[0]) {
                        const projectId = lotResult[0].id_projet;
                        const lotIdNiveau2 = lotResult[0].id_lot;
                        const userId = req.body.userId || null;

                        const [nextEventIdResult] = await sequelize.query(
                            'SELECT COALESCE(MAX(id_event), 0) + 1 as next_id FROM events'
                        );
                        const nextEventId = nextEventIdResult[0].next_id;

                        const changes = {};
                        if (quantite != null && quantite !== oldArticleData.quantite) {
                            changes.quantite = { old: oldArticleData.quantite, new: quantite };
                        }
                        if (nouv_prix != null && nouv_prix !== oldArticleData.nouv_prix) {
                            changes.nouv_prix = { old: oldArticleData.nouv_prix, new: nouv_prix };
                        }

                        await Event.create({
                            id_event: nextEventId,
                            action: 'projet_article_modifier',
                            created_at: new Date(),
                            metadata: changes,
                            user: userId,
                            article: pa.article, // Use catalog article ID
                            ouvrage: structure.ouvrage,
                            bloc: structure.bloc,
                            projet: projectId,
                            lot: lotIdNiveau2
                        });
                    }
                }
            }
        } catch (eventError) {
            console.error('Error creating event log:', eventError);
            // Don't fail the whole operation if event logging fails
        }

        const updated = await ProjetArticle.findByPk(id, {
            include: [
                { model: Article, as: 'articleData' }
            ]
        });

        // Recalculate ouvrage and lot prices after updating article
        try {
            const structure = await Structure.findByPk(pa.structure);
            if (structure) {
                const ouvrage = await Ouvrage.findByPk(structure.ouvrage);
                if (ouvrage) {
                    // Step 1: Recalculate ouvrage prix_total
                    const ouvrageStructures = await Structure.findAll({ where: { ouvrage: ouvrage.id } });
                    const structureIds = ouvrageStructures.map(s => s.id_structure);
                    const ouvrageArticles = await ProjetArticle.findAll({ where: { structure: structureIds } });
                    const ouvragePrixTotal = ouvrageArticles.reduce((sum, art) => sum + (art.total_ttc || 0), 0);
                    await ouvrage.update({ prix_total: ouvragePrixTotal });

                    // Step 2: Recalculate lot prices
                    if (ouvrage.projet_lot) {
                        const lotController = require('./lotController');
                        await lotController.recalculateLotPrices(ouvrage.projet_lot);
                    }
                }
            }
        } catch (error) {
            console.error('Error recalculating ouvrage/lot prices:', error);
        }

        return res.status(200).json({
            success: true,
            data: updated
        });
    } catch (error) {
        console.error('Error updating projet article:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: error.message
        });
    }
};

exports.deleteProjetArticle = async (req, res) => {
    try {
        const { id } = req.params;
        const pa = await ProjetArticle.findByPk(id);
        if (!pa) {
            return res.status(404).json({
                success: false,
                message: 'ProjetArticle not found'
            });
        }

        // Store structure before deleting
        const structureId = pa.structure;

        // Create event log before deletion
        try {
            const structure = await Structure.findByPk(structureId);
            if (structure) {
                const ouvrage = await Ouvrage.findByPk(structure.ouvrage);
                if (ouvrage && ouvrage.projet_lot) {
                    const [lotResult] = await sequelize.query(
                        'SELECT id_projet, id_lot FROM projet_lot WHERE id_projet_lot = :lotId',
                        { replacements: { lotId: ouvrage.projet_lot } }
                    );

                    if (lotResult && lotResult[0]) {
                        const projectId = lotResult[0].id_projet;
                        const lotIdNiveau2 = lotResult[0].id_lot;
                        const userId = req.body.userId || null;

                        const [nextEventIdResult] = await sequelize.query(
                            'SELECT COALESCE(MAX(id_event), 0) + 1 as next_id FROM events'
                        );
                        const nextEventId = nextEventIdResult[0].next_id;

                        await Event.create({
                            id_event: nextEventId,
                            action: 'projet_article_supprimer',
                            created_at: new Date(),
                            metadata: {
                                designation: pa.designation_article,
                                quantite: pa.quantite,
                                nouv_prix: pa.nouv_prix
                            },
                            user: userId,
                            article: pa.article, // Use catalog article ID
                            ouvrage: structure.ouvrage,
                            bloc: structure.bloc,
                            projet: projectId,
                            lot: lotIdNiveau2
                        });
                    }
                }
            }
        } catch (eventError) {
            console.error('Error creating event log:', eventError);
            // Don't fail the whole operation if event logging fails
        }

        // Removed the update query that sets events.article to NULL based on ProjetArticle ID
        // because events.article now references the Catalog Article ID (which is not being deleted)

        await pa.destroy();

        // Recalculate ouvrage and lot prices after deleting article
        try {
            const structure = await Structure.findByPk(structureId);
            if (structure) {
                const ouvrage = await Ouvrage.findByPk(structure.ouvrage);
                if (ouvrage) {
                    // Step 1: Recalculate ouvrage prix_total
                    const ouvrageStructures = await Structure.findAll({ where: { ouvrage: ouvrage.id } });
                    const structureIds = ouvrageStructures.map(s => s.id_structure);
                    const ouvrageArticles = await ProjetArticle.findAll({ where: { structure: structureIds } });
                    const ouvragePrixTotal = ouvrageArticles.reduce((sum, art) => sum + (art.total_ttc || 0), 0);
                    await ouvrage.update({ prix_total: ouvragePrixTotal });

                    // Step 2: Recalculate lot prices
                    if (ouvrage.projet_lot) {
                        const lotController = require('./lotController');
                        await lotController.recalculateLotPrices(ouvrage.projet_lot);
                    }
                }
            }
        } catch (error) {
            console.error('Error recalculating ouvrage/lot prices:', error);
        }

        return res.status(200).json({
            success: true,
            message: 'ProjetArticle deleted successfully',
            data: { id }
        });
    } catch (error) {
        console.error('Error deleting projet article:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: error.message
        });
    }
};
