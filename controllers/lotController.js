const { ProjetLot, Projet, Niveau2, Event, sequelize } = require('../models');

/**
 * Create a new lot for a project
 * POST /api/lots
 */
exports.createLot = async (req, res) => {
    try {
        const { id_projet, id_lot, designation_lot, prix_total, prix_vente } = req.body;

        // Workaround for missing database sequence: manually calculate next ID
        const [maxIdResult] = await sequelize.query(
            'SELECT COALESCE(MAX(id_projet_lot), 0) + 1 as next_id FROM projet_lot'
        );
        const nextId = maxIdResult[0].next_id;

        const lot = await ProjetLot.create({
            id_projet_lot: nextId,
            id_projet,
            id_lot,
            designation_lot,
            prix_total: prix_total || 0,
            prix_vente: prix_vente || 0
        });

        res.status(201).json({
            success: true,
            data: lot
        });

        // Event Logging
        try {
            const [nextEventIdResult] = await sequelize.query(
                'SELECT COALESCE(MAX(id_event), 0) + 1 as next_id FROM events'
            );
            const nextEventId = nextEventIdResult[0].next_id;
            const userId = req.body.userId || null;

            await Event.create({
                id_event: nextEventId,
                action: 'CREATE_LOT',
                created_at: new Date(),
                metadata: { designation: designation_lot },
                user: userId,
                projet: id_projet,
                lot: id_lot
            });
        } catch (logError) {
            console.error('Failed to log CREATE_LOT event:', logError);
        }
    } catch (error) {
        console.error('Error creating lot:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating lot',
            error: error.message
        });
    }
};

/**
 * Update a lot
 * PUT /api/lots/:id
 */
exports.updateLot = async (req, res) => {
    try {
        const { id } = req.params;
        const lot = await ProjetLot.findByPk(id);

        if (!lot) {
            return res.status(404).json({
                success: false,
                message: 'Lot not found'
            });
        }

        await lot.update(req.body);

        res.status(200).json({
            success: true,
            data: lot
        });

        // Event Logging
        try {
            const [nextEventIdResult] = await sequelize.query(
                'SELECT COALESCE(MAX(id_event), 0) + 1 as next_id FROM events'
            );
            const nextEventId = nextEventIdResult[0].next_id;
            const userId = req.body.userId || null;

            await Event.create({
                id_event: nextEventId,
                action: 'UPDATE_LOT',
                created_at: new Date(),
                metadata: {
                    designation_old: lot._previousDataValues?.designation_lot,
                    designation_new: req.body.designation_lot
                },
                user: userId,
                projet: lot.id_projet,
                lot: lot.id_lot
            });
        } catch (logError) {
            console.error('Failed to log UPDATE_LOT event:', logError);
        }
    } catch (error) {
        console.error('Error updating lot:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating lot',
            error: error.message
        });
    }
};

/**
 * Delete a lot
 * DELETE /api/lots/:id
 */
exports.deleteLot = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const { id } = req.params;
        const lot = await ProjetLot.findByPk(id);

        if (!lot) {
            await transaction.rollback();
            return res.status(404).json({
                success: false,
                message: 'Lot not found'
            });
        }

        // Helper to nullify FKs in events
        const nullifyEventFKs = async (table, idColumn, idValue, t) => {
            await sequelize.query(
                `UPDATE events SET ${table} = NULL WHERE ${table} = :id`,
                { transaction: t, replacements: { id: idValue } }
            );
        };

        // 1. Get all ouvrages in this lot to process their dependencies
        const ouvrages = await sequelize.query(
            'SELECT id FROM ouvrage WHERE projet_lot = :lotId',
            { transaction, type: sequelize.QueryTypes.SELECT, replacements: { lotId: id } }
        );
        const ouvrageIds = ouvrages.map(o => o.id);

        if (ouvrageIds.length > 0) {
            // 2. Get all blocs in these ouvrages
            const blocs = await sequelize.query(
                'SELECT id FROM bloc WHERE ouvrage IN (:ouvrageIds)',
                { transaction, type: sequelize.QueryTypes.SELECT, replacements: { ouvrageIds } }
            );
            const blocIds = blocs.map(b => b.id);

            // 3. Delete Project Articles (via structure)
            // Structure for Blocs
            if (blocIds.length > 0) {
                await sequelize.query(
                    `DELETE FROM projet_article WHERE structure IN (SELECT id_structure FROM structure WHERE bloc IN (:blocIds))`,
                    { transaction, replacements: { blocIds } }
                );
                // Nullify events for blocs
                await sequelize.query(
                    `UPDATE events SET bloc = NULL WHERE bloc IN (:blocIds)`,
                    { transaction, replacements: { blocIds } }
                );
            }

            // Structure for Ouvrages (Direct Articles)
            await sequelize.query(
                `DELETE FROM projet_article WHERE structure IN (SELECT id_structure FROM structure WHERE ouvrage IN (:ouvrageIds))`,
                { transaction, replacements: { ouvrageIds } }
            );

            // 4. Delete Structures
            if (blocIds.length > 0) {
                await sequelize.query(
                    `DELETE FROM structure WHERE bloc IN (:blocIds)`,
                    { transaction, replacements: { blocIds } }
                );
            }
            await sequelize.query(
                `DELETE FROM structure WHERE ouvrage IN (:ouvrageIds)`,
                { transaction, replacements: { ouvrageIds } }
            );

            // 5. Delete Blocs
            if (blocIds.length > 0) {
                await sequelize.query(
                    `DELETE FROM bloc WHERE id IN (:blocIds)`,
                    { transaction, replacements: { blocIds } }
                );
            }

            // 6. Delete Ouvrages
            // Nullify events for ouvrages first
            await sequelize.query(
                `UPDATE events SET ouvrage = NULL WHERE ouvrage IN (:ouvrageIds)`,
                { transaction, replacements: { ouvrageIds } }
            );
            await sequelize.query(
                `DELETE FROM ouvrage WHERE id IN (:ouvrageIds)`,
                { transaction, replacements: { ouvrageIds } }
            );
        }

        // 7. Finally delete the Lot
        await lot.destroy({ transaction });
        await transaction.commit();

        res.status(200).json({
            success: true,
            message: 'Lot deleted successfully'
        });

        // Event Logging (after commit)
        try {
            const [nextEventIdResult] = await sequelize.query(
                'SELECT COALESCE(MAX(id_event), 0) + 1 as next_id FROM events'
            );
            const nextEventId = nextEventIdResult[0].next_id;
            const userId = req.body.userId || req.query.userId || null;

            await Event.create({
                id_event: nextEventId,
                action: 'DELETE_LOT',
                created_at: new Date(),
                metadata: { designation: lot.designation_lot },
                user: userId,
                projet: lot.id_projet,
                lot: lot.id_lot
            });
        } catch (logError) {
            console.error('Failed to log DELETE_LOT event:', logError);
        }
    } catch (error) {
        await transaction.rollback();
        console.error('Error deleting lot:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting lot',
            error: error.message
        });
    }
};

/**
 * Recalculate and update lot prices based on sum of ouvrages
 * This should be called after any article/ouvrage operation that affects prices
 */
exports.recalculateLotPrices = async (lotId, transaction) => {
    try {
        const { Ouvrage } = require('../models');

        // Get all ouvrages for this lot
        const ouvrages = await Ouvrage.findAll({
            where: { projet_lot: lotId },
            ...(transaction && { transaction })
        });

        // Calculate total from ouvrages
        const prix_total = ouvrages.reduce((sum, ouvrage) => sum + (ouvrage.prix_total || 0), 0);
        const prix_vente = prix_total; // Can be adjusted with markup if needed

        console.log(`Calculated prices for lot ${lotId}: prix_total=${prix_total}, prix_vente=${prix_vente}`);
        console.log(`About to UPDATE projet_lot WHERE id_projet_lot=${lotId}`);

        // Update the lot
        const [rowsUpdated] = await ProjetLot.update(
            { prix_total, prix_vente },
            {
                where: { id_projet_lot: lotId },
                ...(transaction && { transaction })
            }
        );

        console.log(`UPDATE completed: ${rowsUpdated} row(s) affected`);

        // Verify the update
        const verifyLot = await ProjetLot.findByPk(lotId);
        console.log(`Verification - Lot ${lotId} in DB: prix_total=${verifyLot?.prix_total}, prix_vente=${verifyLot?.prix_vente}`);

        console.log(`Updated lot ${lotId} prices: prix_total=${prix_total}, prix_vente=${prix_vente}`);
        return { prix_total, prix_vente };
    } catch (error) {
        console.error(`Error recalculating lot ${lotId} prices:`, error);
        throw error;
    }
};
