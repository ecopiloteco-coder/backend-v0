const { Bloc, Structure, Ouvrage, Event, sequelize } = require('../models');
const { generateUniqueId } = require('../utils/idGenerator');

/**
 * Create a new Bloc
 * POST /api/blocs
 */
exports.createBloc = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const { nom_bloc, unite, quantite, pu, pt, designation, ouvrage } = req.body;

        if (!ouvrage) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                message: 'Ouvrage obligatoire pour créer un bloc'
            });
        }

        const parentOuvrage = await Ouvrage.findByPk(ouvrage, { transaction });
        if (!parentOuvrage) {
            await transaction.rollback();
            return res.status(404).json({
                success: false,
                message: 'Ouvrage introuvable'
            });
        }

        const nextBlocId = await generateUniqueId(transaction);

        const bloc = await Bloc.create({
            id: nextBlocId,
            nom_bloc,
            unite,
            quantite,
            pu,
            pt: pt ?? (quantite && pu ? quantite * pu : null),
            designation,
            ouvrage: parentOuvrage.id
        }, { transaction });

        const [nextStructureIdResult] = await sequelize.query(
            'SELECT COALESCE(MAX(id_structure), 0) + 1 as next_id FROM structure',
            { transaction }
        );
        const nextStructureId = nextStructureIdResult[0].next_id;

        await Structure.create({
            id_structure: nextStructureId,
            ouvrage: parentOuvrage.id,
            bloc: bloc.id,
            action: 'bloc'
        }, { transaction });

        // Create event log - automatically find projectId from ouvrage
        try {
            const ouvrageWithLot = await Ouvrage.findByPk(parentOuvrage.id, {
                attributes: ['projet_lot'],
                transaction
            });

            if (ouvrageWithLot && ouvrageWithLot.projet_lot) {
                const [lotResult] = await sequelize.query(
                    'SELECT id_projet, id_lot FROM projet_lot WHERE id_projet_lot = :lotId',
                    { replacements: { lotId: ouvrageWithLot.projet_lot }, transaction }
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
                        action: 'bloc_created',
                        created_at: new Date(),
                        metadata: { nom_bloc, designation },
                        user: userId,
                        bloc: bloc.id,
                        ouvrage: parentOuvrage.id,
                        projet: projectId,
                        lot: lotIdNiveau2
                    }, { transaction });
                }
            }
        } catch (eventError) {
            console.error('Error creating event log:', eventError);
            // Don't fail the whole operation if event logging fails
        }

        await transaction.commit();

        res.status(201).json({
            success: true,
            data: bloc
        });
    } catch (error) {
        await transaction.rollback();
        console.error('Error creating bloc:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating bloc',
            error: error.message
        });
    }
};

/**
 * Get a single Bloc by ID
 * GET /api/blocs/:id
 */
exports.getBloc = async (req, res) => {
    try {
        const { id } = req.params;
        const bloc = await Bloc.findByPk(id);

        if (!bloc) {
            return res.status(404).json({
                success: false,
                message: 'Bloc not found'
            });
        }

        res.status(200).json({
            success: true,
            data: bloc
        });
    } catch (error) {
        console.error('Error fetching bloc:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching bloc',
            error: error.message
        });
    }
};

/**
 * Update a Bloc
 * PUT /api/blocs/:id
 */
exports.updateBloc = async (req, res) => {
    try {
        const { id } = req.params;
        const bloc = await Bloc.findByPk(id);

        if (!bloc) {
            return res.status(404).json({
                success: false,
                message: 'Bloc not found'
            });
        }

        const oldBlocData = bloc.toJSON();
        const incoming = req.body || {};
        const quant = incoming.quantite != null ? incoming.quantite : bloc.quantite;
        const pu = incoming.pu != null ? incoming.pu : bloc.pu;
        if (quant != null && pu != null) {
            incoming.pt = Number(quant) * Number(pu);
        }
        await bloc.update(incoming);

        // Create event log - automatically find projectId from ouvrage
        try {
            const ouvrageWithLot = await Ouvrage.findByPk(bloc.ouvrage, {
                attributes: ['projet_lot']
            });

            if (ouvrageWithLot && ouvrageWithLot.projet_lot) {
                const [lotResult] = await sequelize.query(
                    'SELECT id_projet, id_lot FROM projet_lot WHERE id_projet_lot = :lotId',
                    { replacements: { lotId: ouvrageWithLot.projet_lot } }
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
                    if (req.body.nom_bloc && req.body.nom_bloc !== oldBlocData.nom_bloc) {
                        changes.nom_bloc = { old: oldBlocData.nom_bloc, new: req.body.nom_bloc };
                    }
                    if (req.body.designation && req.body.designation !== oldBlocData.designation) {
                        changes.designation = { old: oldBlocData.designation, new: req.body.designation };
                    }
                    if (req.body.quantite && req.body.quantite !== oldBlocData.quantite) {
                        changes.quantite = { old: oldBlocData.quantite, new: req.body.quantite };
                    }
                    if (req.body.pu && req.body.pu !== oldBlocData.pu) {
                        changes.pu = { old: oldBlocData.pu, new: req.body.pu };
                    }

                    await Event.create({
                        id_event: nextEventId,
                        action: 'bloc_modifier',
                        created_at: new Date(),
                        metadata: changes,
                        user: userId,
                        bloc: bloc.id,
                        bloc_nom_anc: oldBlocData.nom_bloc,
                        ouvrage: bloc.ouvrage,
                        projet: projectId,
                        lot: lotIdNiveau2
                    });
                }
            }
        } catch (eventError) {
            console.error('Error creating event log:', eventError);
            // Don't fail the whole operation if event logging fails
        }

        res.status(200).json({
            success: true,
            data: bloc
        });
    } catch (error) {
        console.error('Error updating bloc:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating bloc',
            error: error.message
        });
    }
};

/**
 * Delete a Bloc
 * DELETE /api/blocs/:id
 */
exports.deleteBloc = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const { id } = req.params;
        const bloc = await Bloc.findByPk(id);

        if (!bloc) {
            await transaction.rollback();
            return res.status(404).json({
                success: false,
                message: 'Bloc not found'
            });
        }

        await sequelize.query(
            `
            DELETE FROM projet_article 
            WHERE structure IN (
                SELECT id_structure FROM structure WHERE bloc = :blocId
            )
            `,
            { transaction, replacements: { blocId: id } }
        );

        await sequelize.query(
            `DELETE FROM structure WHERE bloc = :blocId`,
            { transaction, replacements: { blocId: id } }
        );

        // Create event log before deletion - automatically find projectId from ouvrage
        try {
            const ouvrageWithLot = await Ouvrage.findByPk(bloc.ouvrage, {
                attributes: ['projet_lot'],
                transaction
            });

            if (ouvrageWithLot && ouvrageWithLot.projet_lot) {
                const [lotResult] = await sequelize.query(
                    'SELECT id_projet, id_lot FROM projet_lot WHERE id_projet_lot = :lotId',
                    { replacements: { lotId: ouvrageWithLot.projet_lot }, transaction }
                );

                if (lotResult && lotResult[0]) {
                    const projectId = lotResult[0].id_projet;
                    const lotIdNiveau2 = lotResult[0].id_lot;
                    const userId = req.body.userId || req.query.userId || null;

                    const [nextEventIdResult] = await sequelize.query(
                        'SELECT COALESCE(MAX(id_event), 0) + 1 as next_id FROM events',
                        { transaction }
                    );
                    const nextEventId = nextEventIdResult[0].next_id;

                    await Event.create({
                        id_event: nextEventId,
                        action: 'bloc_supprimer',
                        created_at: new Date(),
                        metadata: { nom_bloc: bloc.nom_bloc, designation: bloc.designation },
                        user: userId,
                        bloc_nom_anc: bloc.nom_bloc,
                        ouvrage: bloc.ouvrage,
                        projet: projectId,
                        lot: lotIdNiveau2
                        // NOTE: Don't include 'bloc' field here because we're about to delete it
                        // and it would cause a foreign key constraint violation
                    }, { transaction });
                }
            }
        } catch (eventError) {
            console.error('Error creating event log:', eventError);
            // Don't fail the whole operation if event logging fails
        }

        // Set bloc to NULL in existing events to avoid foreign key constraint violation
        await sequelize.query(
            `UPDATE events SET bloc = NULL WHERE bloc = :blocId`,
            { transaction, replacements: { blocId: id } }
        );

        await bloc.destroy({ transaction });
        await transaction.commit();

        res.status(200).json({
            success: true,
            message: 'Bloc deleted successfully'
        });
    } catch (error) {
        await transaction.rollback();
        console.error('Error deleting bloc:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting bloc',
            error: error.message
        });
    }
};
