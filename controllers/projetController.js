const { Projet, Client, User, ProjetEquipe, sequelize } = require('../models');

/**
 * Get all projects
 * GET /api/projets
 */
exports.getAllProjets = async (req, res) => {
    try {
        const projets = await Projet.findAll({
            include: [
                {
                    model: Client,
                    as: 'clientData',
                    attributes: ['id', 'nom_client', 'agence', 'marge_brut', 'marge_net']
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'nom_utilisateur', 'email']
                },
                {
                    model: ProjetEquipe,
                    as: 'teamMembers',
                    include: [
                        {
                            model: User,
                            as: 'userData',
                            attributes: ['id', 'nom_utilisateur', 'email']
                        }
                    ]
                }
            ],
            order: [['id', 'ASC']] // Order by ID ascending - oldest first, newest last
        });

        res.status(200).json({
            success: true,
            data: projets
        });
    } catch (error) {
        console.error('Error fetching projects:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching projects',
            error: error.message
        });
    }
};

/**
 * Get project by ID
 * GET /api/projets/:id
 */
exports.getProjetById = async (req, res) => {
    try {
        const projet = await Projet.findByPk(req.params.id, {
            include: [
                {
                    model: Client,
                    as: 'clientData'
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'nom_utilisateur', 'email', 'titre_poste']
                }
            ]
        });

        if (!projet) {
            return res.status(404).json({
                success: false,
                message: 'Project not found'
            });
        }

        res.status(200).json({
            success: true,
            data: projet
        });
    } catch (error) {
        console.error('Error fetching project:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching project',
            error: error.message
        });
    }
};

/**
 * Create new project
 * POST /api/projets
 */
exports.createProjet = async (req, res) => {
    try {
        // Workaround for missing database sequence: manually calculate next ID
        const [maxIdResult] = await sequelize.query(
            'SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM projets'
        );
        const nextId = maxIdResult[0].next_id;

        // Validate user exists if Ajouté_par is provided
        let userId = req.body.Ajouté_par || req.body['Ajouté_par'];
        if (userId) {
            const user = await User.findByPk(userId);
            if (!user) {
                console.warn(`User ID ${userId} not found, setting Ajouté_par to null`);
                userId = null;
            }
        }

        // Extract team members from request body
        const teamMembers = req.body.team || req.body.teamMembers || [];

        // Create project with explicit ID and validated user
        const projet = await Projet.create({
            ...req.body,
            id: nextId,
            Ajouté_par: userId
        });

        // Save team member assignments to projet_equipe table
        if (Array.isArray(teamMembers) && teamMembers.length > 0) {
            // Get next available ID for projet_equipe
            const [maxTeamIdResult] = await sequelize.query(
                'SELECT COALESCE(MAX(id), 0) as max_id FROM projet_equipe'
            );
            let nextTeamId = (maxTeamIdResult[0].max_id || 0) + 1;

            const teamAssignments = teamMembers.map(member => ({
                id: nextTeamId++,
                projet: projet.id,
                equipe: typeof member === 'object' ? member.id : member
            }));

            await ProjetEquipe.bulkCreate(teamAssignments);
            console.log(`Assigned ${teamAssignments.length} team members to project ${projet.id}`);
        }

        res.status(201).json({
            success: true,
            data: projet
        });
    } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating project',
            error: error.message
        });
    }
};

/**
 * Update project
 * PUT /api/projets/:id
 */
exports.updateProjet = async (req, res) => {
    try {
        const projet = await Projet.findByPk(req.params.id);

        if (!projet) {
            return res.status(404).json({
                success: false,
                message: 'Project not found'
            });
        }

        // Extract team members from request body
        const teamMembers = req.body.team || req.body.teamMembers;

        // Update project details
        await projet.update(req.body);

        // Update team member assignments if provided
        if (Array.isArray(teamMembers)) {
            // Delete existing team assignments
            await ProjetEquipe.destroy({
                where: { projet: req.params.id }
            });

            // Create new team assignments
            if (teamMembers.length > 0) {
                // Get next available ID for projet_equipe
                const [maxTeamIdResult] = await sequelize.query(
                    'SELECT COALESCE(MAX(id), 0) as max_id FROM projet_equipe'
                );
                let nextTeamId = (maxTeamIdResult[0].max_id || 0) + 1;

                const teamAssignments = teamMembers.map(member => ({
                    id: nextTeamId++,
                    projet: projet.id,
                    equipe: typeof member === 'object' ? member.id : member
                }));

                await ProjetEquipe.bulkCreate(teamAssignments);
                console.log(`Updated team: ${teamAssignments.length} members for project ${projet.id}`);
            }
        }

        res.status(200).json({
            success: true,
            data: projet
        });
    } catch (error) {
        console.error('Error updating project:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating project',
            error: error.message
        });
    }
};

/**
 * Delete project
 * DELETE /api/projets/:id
 */
exports.deleteProjet = async (req, res) => {
    try {
        const projet = await Projet.findByPk(req.params.id);

        if (!projet) {
            return res.status(404).json({
                success: false,
                message: 'Project not found'
            });
        }

        const t = await sequelize.transaction();

        try {
            // 1. Delete Team Members
            await ProjetEquipe.destroy({
                where: { projet: req.params.id },
                transaction: t
            });

            // 2. Delete Notifications related to project events
            await sequelize.query(`
                DELETE FROM notifs 
                WHERE event IN (SELECT id_event FROM events WHERE projet = :id)
            `, {
                replacements: { id: req.params.id },
                transaction: t
            });

            // 3. Delete Events
            await sequelize.query('DELETE FROM events WHERE projet = :id', {
                replacements: { id: req.params.id },
                transaction: t
            });

            // 4. Delete Project Articles (and their structures/blocs/ouvrages/lots hierarchy)
            // 4a. Delete Projet Articles
            await sequelize.query(`
                DELETE FROM projet_article 
                WHERE structure IN (
                    SELECT s.id_structure 
                    FROM structure s
                    JOIN ouvrage o ON s.ouvrage = o.id
                    JOIN projet_lot pl ON o.projet_lot = pl.id_projet_lot
                    WHERE pl.id_projet = :id
                )
            `, {
                replacements: { id: req.params.id },
                transaction: t
            });

            // 4b. Delete Structures
            await sequelize.query(`
                DELETE FROM structure 
                WHERE ouvrage IN (
                    SELECT o.id 
                    FROM ouvrage o
                    JOIN projet_lot pl ON o.projet_lot = pl.id_projet_lot
                    WHERE pl.id_projet = :id
                )
            `, {
                replacements: { id: req.params.id },
                transaction: t
            });

            // 4c. Delete Blocs (associated with ouvrages in the project)
            await sequelize.query(`
                DELETE FROM bloc 
                WHERE ouvrage IN (
                    SELECT o.id 
                    FROM ouvrage o
                    JOIN projet_lot pl ON o.projet_lot = pl.id_projet_lot
                    WHERE pl.id_projet = :id
                )
            `, {
                replacements: { id: req.params.id },
                transaction: t
            });

            // 4d. Delete Ouvrages
            await sequelize.query(`
                DELETE FROM ouvrage 
                WHERE projet_lot IN (
                    SELECT id_projet_lot 
                    FROM projet_lot 
                    WHERE id_projet = :id
                )
            `, {
                replacements: { id: req.params.id },
                transaction: t
            });

            // 4e. Delete Projet Lots
            await sequelize.query('DELETE FROM projet_lot WHERE id_projet = :id', {
                replacements: { id: req.params.id },
                transaction: t
            });

            // 5. Finally delete the Project
            await projet.destroy({ transaction: t });

            await t.commit();
        } catch (err) {
            await t.rollback();
            throw err;
        }

        res.status(200).json({
            success: true,
            message: 'Project deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting project:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting project',
            error: error.message
        });
    }
};
