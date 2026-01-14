const { Event, User, Article, Bloc, Ouvrage, Niveau2 } = require('../models');

/**
 * Get all events for a specific project
 * GET /api/events/project/:projectId
 */
exports.getProjectEvents = async (req, res) => {
    try {
        const { projectId } = req.params;

        const events = await Event.findAll({
            where: { projet: projectId },
            include: [
                {
                    model: User,
                    as: 'userData',
                    attributes: ['id', 'nom_utilisateur', 'email']
                },
                {
                    model: Article,
                    as: 'articleData',
                    attributes: ['ID', 'nom_article'],
                    required: false
                },
                {
                    model: Bloc,
                    as: 'blocData',
                    attributes: ['id', 'nom_bloc'],
                    required: false
                },
                {
                    model: Ouvrage,
                    as: 'ouvrageData',
                    attributes: ['id', 'nom_ouvrage'],
                    required: false
                },
                {
                    model: Niveau2,
                    as: 'lotData',
                    attributes: ['id_niveau_2', 'niveau_2'],
                    required: false
                }
            ],
            order: [['created_at', 'DESC']]
        });

        res.status(200).json({
            success: true,
            data: events
        });
    } catch (error) {
        console.error('Error fetching project events:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching project events',
            error: error.message
        });
    }
};
