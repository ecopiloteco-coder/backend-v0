const pool = require('../../config/db');
const EventNotificationService = require('../services/EventNotificationService');
const Gbloc = require('./Gbloc');
const { ensureLotId } = require('../utils/lotHelper');
const Structure = require('./Structure');

class Bloc {
    /**
     * Create a new bloc with comprehensive validation and transaction safety
     */
    static async create(projectId, blocData, userId, isAdmin = false) {
        console.log(`📝 Bloc.create called for project ${projectId}`, { blocData });
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

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

            const { nom_bloc, unite = null, quantite = null, pu = null, pt = null, lot = null, ouvrage = null, g_bloc = null, designation = null } = blocData;
            const lotLabel = typeof lot === 'string' ? lot.trim() : null;
            const resolvedLotId = lotLabel ? await ensureLotId(client, lotLabel) : null;

            // Do NOT infer ouvrage from lot; only use an explicit ouvrage when provided
            let effectiveGbloc = (ouvrage !== undefined && ouvrage !== null) ? ouvrage : ((g_bloc !== undefined && g_bloc !== null) ? g_bloc : null);

            // ✅ STRICT VALIDATION: Ouvrage is required for creating a Bloc
            if (!effectiveGbloc) {
                throw new Error('Ouvrage ID is required to create a Bloc. Orphan Blocs are not allowed.');
            }

            // Use default name if nom_bloc is not provided or empty
            const blocName = (nom_bloc && String(nom_bloc).trim()) ? String(nom_bloc).trim() : `Bloc-${Date.now()}`;

            // Use user-provided bloc designation (allow duplicates)
            let blocDesignation = null;
            if (designation && typeof designation === 'string' && designation.trim()) {
                blocDesignation = designation.trim();
            }

            // ✅ Ensure first bloc always starts at ID=2 (skip ID=1)
            const countRes = await client.query('SELECT COUNT(*) as count FROM bloc');
            const blocCount = parseInt(countRes.rows[0].count);

            let row;
            if (blocCount === 0) {
                // First bloc ever - assign ID=1 directly to match structure table expectations
                const ins = await client.query(
                    'INSERT INTO bloc (id, nom_bloc, unite, quantite, pu, pt, designation, ouvrage) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
                    [1, blocName, unite, quantite, pu, pt, blocDesignation, effectiveGbloc]
                );
                row = ins.rows[0];
                console.log('✅ First bloc created with ID=1');
            } else {
                // Normal bloc creation with auto-increment
                await client.query('SAVEPOINT insert_bloc');
                try {
                    const ins = await client.query(
                        'INSERT INTO bloc (nom_bloc, unite, quantite, pu, pt, designation, ouvrage) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
                        [blocName, unite, quantite, pu, pt, blocDesignation, effectiveGbloc]
                    );
                    row = ins.rows[0];
                    await client.query('RELEASE SAVEPOINT insert_bloc');
                } catch (insertError) {
                    // If default fails, rollback to savepoint and try with manual ID
                    await client.query('ROLLBACK TO SAVEPOINT insert_bloc');
                    const maxRes = await client.query('SELECT COALESCE(MAX(id), 0) AS max_id FROM bloc');
                    const nextId = maxRes.rows[0].max_id + 1;
                    const ins = await client.query(
                        'INSERT INTO bloc (id, nom_bloc, unite, quantite, pu, pt, designation, ouvrage) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
                        [nextId, blocName, unite, quantite, pu, pt, blocDesignation, effectiveGbloc]
                    );
                    row = ins.rows[0];
                }
            }

            // ✅ ALGORITHM: Prevent bloc.id from conflicting with ANY ouvrage ID
            // Use the ID conflict resolver to check all ouvrages globally
            const { getNextAvailableBlocId } = require('../utils/idConflictResolver');
            const safeBlocId = await getNextAvailableBlocId(row.id);

            if (safeBlocId !== row.id) {
                console.warn(`⚠️ Conflict detected: bloc.id (${row.id}) conflicts with ouvrage IDs`);

                // Update bloc with the safe ID
                await client.query(
                    'UPDATE bloc SET id = $1 WHERE id = $2',
                    [safeBlocId, row.id]
                );

                console.log(`✅ Bloc ID changed: ${row.id} → ${safeBlocId} to avoid conflict with ouvrage IDs`);
                row.id = safeBlocId;
            }


            // ✅ PREVENT AUTOMATIC PROJET_ARTICLE CREATION: Only create projet_article entries when articles are explicitly added via structure IDs
            // This removes the automatic creation of projet_article rows during bloc creation
            // projet_article should only be created when articles are explicitly added through the structure system

            // ✅ Link bloc to its ouvrage via structure
            if (effectiveGbloc) {
                // Optionally ensure the ouvrage is linked to the provided lot
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
                    await client.query('UPDATE ouvrage SET projet_lot = $1 WHERE id = $2', [projetLotId, effectiveGbloc]);
                }

                // Create structure link using Structure.findOrCreate to ensure action field is set
                await Structure.findOrCreate(effectiveGbloc, row.id, client);
            }

            await client.query('COMMIT');
            setImmediate(async () => {
                try {
                    console.log('🔔 Creating bloc event:', { projectId, blocId: row.id, userId, nom_bloc: blocName, g_bloc: effectiveGbloc || g_bloc, lot: lotLabel });

                    await EventNotificationService.blocCreated(projectId, row.id, userId, {
                        nom_bloc: blocName,
                        unite,
                        quantite,
                        lot: lotLabel,
                        g_bloc: effectiveGbloc || g_bloc,
                        gbloc_name: null
                    });
                    console.log('✅ Bloc event created successfully');
                } catch (eventError) {
                    console.error('❌ Failed to create bloc creation event:', eventError);
                }
            });

            return row;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Update a bloc with comprehensive validation
     */
    static async update(projectId, blocId, updateData, userId, isAdmin = false) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

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

            // Get current bloc data
            const currentResult = await client.query('SELECT * FROM bloc WHERE id = $1', [blocId]);
            if (currentResult.rows.length === 0) {
                throw new Error('Bloc not found');
            }
            const current = currentResult.rows[0];

            const { nom_bloc, unite, quantite, pu, pt, designation } = updateData;

            // Allow duplicate bloc names (validation removed)



            // Allow clearing fields by accepting explicit null/empty values, but skip undefined fields
            const updateFields = [];
            const updateValues = [];
            let paramIndex = 1;

            // ✅ FETCH CURRENT BLOC DATA: Need to get current pt value for pu recalculation
            let currentBloc = null;
            if (quantite !== undefined) {
                const fetchResult = await client.query('SELECT pt, quantite FROM bloc WHERE id = $1', [blocId]);
                if (fetchResult.rows.length > 0) {
                    currentBloc = fetchResult.rows[0];
                }
            }

            if (nom_bloc !== undefined) {
                updateFields.push(`nom_bloc = $${paramIndex++}`);
                updateValues.push(nom_bloc);
            }
            if (unite !== undefined) {
                updateFields.push(`unite = $${paramIndex++}`);
                updateValues.push(unite);
            }
            if (quantite !== undefined) {
                updateFields.push(`quantite = $${paramIndex++}`);
                updateValues.push(quantite);

                // ✅ AUTO-NULLIFY: If quantite is set to null/0/empty, also set pu to null
                // Unit price (pu) cannot exist without quantity
                if (quantite === null || quantite === '' || quantite === 0 || quantite === '0') {
                    updateFields.push(`pu = $${paramIndex++}`);
                    updateValues.push(null);
                    console.log(`✅ Auto-nullifying pu because quantite is being set to ${quantite}`);
                }
                // ✅ AUTO-RECALCULATE: If quantite changes and pt exists, recalculate pu = pt / quantite
                else if (currentBloc && currentBloc.pt !== null && currentBloc.pt !== undefined) {
                    const newQuantite = parseFloat(quantite);
                    const currentPt = parseFloat(currentBloc.pt);

                    if (!isNaN(newQuantite) && newQuantite > 0 && !isNaN(currentPt)) {
                        const recalculatedPu = currentPt / newQuantite;
                        updateFields.push(`pu = $${paramIndex++}`);
                        updateValues.push(recalculatedPu);
                        console.log(`✅ Auto-recalculating pu: ${currentPt} / ${newQuantite} = ${recalculatedPu}`);
                    }
                }
            }
            if (pu !== undefined) {
                updateFields.push(`pu = $${paramIndex++}`);
                updateValues.push(pu);
            }
            if (pt !== undefined) {
                updateFields.push(`pt = $${paramIndex++}`);
                updateValues.push(pt);
            }
            if (designation !== undefined) {
                updateFields.push(`designation = $${paramIndex++}`);
                updateValues.push(designation);
            }

            if (updateFields.length === 0) {
                throw new Error('Aucun champ à mettre à jour');
            }

            const updateSql = `
                UPDATE bloc SET
                    ${updateFields.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING *
            `;

            updateValues.push(blocId);

            const result = await client.query(updateSql, updateValues);

            await client.query('COMMIT');

            // Create event notification for bloc update
            setImmediate(async () => {
                try {
                    // Get ouvrage ID and lot information for the bloc
                    const contextQuery = `
                        SELECT DISTINCT 
                            s.ouvrage,
                            o.nom_ouvrage,
                            pl.id_lot,
                            n2.niveau_2 as lot_name
                        FROM structure s
                        INNER JOIN ouvrage o ON o.id = s.ouvrage
                        LEFT JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                        LEFT JOIN niveau_2 n2 ON n2.id_niveau_2 = pl.id_lot
                        WHERE s.bloc = $1 AND pl.id_projet = $2
                        LIMIT 1
                    `;
                    const contextResult = await pool.query(contextQuery, [blocId, projectId]);
                    const gblocId = contextResult.rows[0]?.ouvrage || null;
                    const lotName = contextResult.rows[0]?.lot_name || null;

                    // Build changes object
                    const changes = {};
                    if (nom_bloc !== undefined && nom_bloc !== current.nom_bloc) {
                        changes.nom_bloc = { from: current.nom_bloc, to: nom_bloc };
                    }
                    if (unite !== undefined && unite !== current.unite) {
                        changes.unite = { from: current.unite, to: unite };
                    }
                    if (quantite !== undefined && quantite !== current.quantite) {
                        changes.quantite = { from: current.quantite, to: quantite };
                    }
                    if (pu !== undefined && pu !== current.pu) {
                        changes.pu = { from: current.pu, to: pu };
                    }
                    if (pt !== undefined && pt !== current.pt) {
                        changes.pt = { from: current.pt, to: pt };
                    }
                    if (designation !== undefined && designation !== current.designation) {
                        changes.designation = { from: current.designation, to: designation };
                    }

                    // Only create event if there are actual changes
                    if (Object.keys(changes).length > 0) {
                        console.log('🔔 Creating bloc update event:', { projectId, blocId, userId, changes, gblocId, lotName });
                        await EventNotificationService.blocUpdated(projectId, blocId, userId, changes, gblocId, lotName);
                        console.log('✅ Bloc update event created successfully');
                    }
                } catch (eventError) {
                    console.error('❌ Failed to create bloc update event:', eventError);
                }
            });

            return result.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Delete a bloc with comprehensive cleanup
     */
    static async delete(projectId, blocId, userId, isAdmin = false) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

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

            // Get bloc name before deletion
            const blocResult = await client.query('SELECT nom_bloc FROM bloc WHERE id = $1', [blocId]);
            if (blocResult.rows.length === 0) {
                throw new Error('Bloc not found');
            }
            const blocName = blocResult.rows[0].nom_bloc;

            // Delete all projet_article rows linked to this bloc
            const deleteResult = await client.query(
                'DELETE FROM projet_article WHERE projet = $1 AND bloc = $2',
                [projectId, blocId]
            );

            // Delete the bloc itself
            const blocDeleteResult = await client.query(
                'DELETE FROM bloc WHERE id = $1',
                [blocId]
            );

            await client.query('COMMIT');
            return {
                deleted: blocDeleteResult.rowCount > 0,
                articlesDeleted: deleteResult.rowCount,
                blocName: blocName
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get bloc by ID
     */
    static async findById(blocId) {
        const query = 'SELECT * FROM bloc WHERE id = $1';
        const result = await pool.query(query, [blocId]);
        return result.rows[0] || null;
    }

    /**
     * Get all blocs for a project
     */
    static async findByProject(projectId) {
        const query = `
            SELECT DISTINCT b.*, pl.id_lot as lot, s.ouvrage as g_bloc
            FROM bloc b
            INNER JOIN structure s ON s.bloc = b.id
            INNER JOIN ouvrage o ON o.id = s.ouvrage
            INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
            INNER JOIN projet_article pa ON pa.structure = s.id_structure
            WHERE pl.id_projet = $1
            ORDER BY b.designation
        `;
        const result = await pool.query(query, [projectId]);
        return result.rows;
    }

    /**
     * Get blocs by ouvrage
     */
    static async findByOuvrage(projectId, ouvrageId) {
        const query = `
            SELECT DISTINCT b.*, pl.id_lot as lot
            FROM bloc b
            INNER JOIN structure s ON s.bloc = b.id
            INNER JOIN ouvrage o ON o.id = s.ouvrage
            INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
            INNER JOIN projet_article pa ON pa.structure = s.id_structure
            WHERE pl.id_projet = $1 AND s.ouvrage = $2
            ORDER BY b.designation
        `;
        const result = await pool.query(query, [projectId, ouvrageId]);
        return result.rows;
    }
}

module.exports = Bloc;
