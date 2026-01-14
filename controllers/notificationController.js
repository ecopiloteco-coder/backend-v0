const { Notif, Event, User, Projet, Article, Bloc, Ouvrage, Niveau2 } = require('../models');
const { Op } = require('sequelize');

exports.getNotifications = async (req, res) => {
    try {
        const userId = req.body.userId || req.query.userId; // Usually from auth middleware req.user.id

        if (!userId) {
            return res.status(400).json({ success: false, message: 'User ID required' });
        }

        const limit = parseInt(req.query.limit) || 20;

        const notifs = await Notif.findAll({
            where: { user_recep: userId },
            include: [
                {
                    model: Event,
                    as: 'eventData',
                    include: [
                        { model: User, as: 'userData' },
                        { model: Projet, as: 'projetData' },
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
                    ]
                }
            ],
            order: [['created_at', 'DESC']],
            limit: limit
        });

        // Map to frontend friendly format
        const formattedNotifs = notifs.map(n => {
            const event = n.eventData;
            let title = 'Notification';
            let message = 'Nouvel événement';
            let type = 'info';

            if (event) {
                const actorName = event.userData ? event.userData.nom_utilisateur : 'Utilisateur';
                const projectName = event.projetData ? event.projetData.Nom_Projet : 'un projet';

                switch (event.action) {
                    case 'projet_ajouter':
                        title = 'Nouveau Projet';
                        message = `${actorName} a créé le projet "${projectName}"`;
                        type = 'success';
                        break;
                    case 'ouvrage_ajouter':
                        title = 'Nouvel Ouvrage';
                        message = `${actorName} a ajouté un ouvrage dans "${projectName}"`;
                        break;
                    case 'bloc_created':
                        title = 'Nouveau Lot';
                        message = `${actorName} a ajouté un lot dans "${projectName}"`;
                        break;
                    case 'projet_article_ajouter':
                        title = 'Nouvel Article';
                        message = `${actorName} a ajouté un article dans "${projectName}"`;
                        break;
                    case 'projet_article_modifier':
                    case 'ouvrage_modifier':
                    case 'bloc_modifier':
                        title = 'Modification';
                        message = `${actorName} a modifié des éléments dans "${projectName}"`;
                        type = 'warning';
                        break;
                    case 'projet_article_supprimer':
                    case 'ouvrage_supprimer':
                    case 'bloc_supprimer':
                        title = 'Suppression';
                        message = `${actorName} a supprimé des éléments dans "${projectName}"`;
                        type = 'warning'; // or error
                        break;
                    default:
                        message = `${actorName} a effectué une action: ${event.action}`;
                }
            }

            return {
                id: n.id_notif,
                type,
                title,
                message,
                read: n.is_read,
                createdAt: n.created_at,
                projectId: event ? event.projet : null,
                projectName: event && event.projetData ? event.projetData.Nom_Projet : null,
                actorName: event && event.userData ? event.userData.nom_utilisateur : null,
                action: event ? event.action : null,
                articleName: event && event.articleData ? event.articleData.nom_article : null,
                blocName: event && event.blocData ? event.blocData.nom_bloc : null,
                ouvrageName: event && event.ouvrageData ? event.ouvrageData.nom_ouvrage : null,
                lotName: event && event.lotData ? event.lotData.niveau_2 : null
            };
        });

        res.status(200).json({
            success: true,
            data: formattedNotifs
        });

    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
};

exports.markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.body.userId; // Verify ownership if strictly needed

        await Notif.update(
            { is_read: true, read_at: new Date() },
            { where: { id_notif: id } }
        );

        res.status(200).json({ success: true, message: 'Notification marquée comme lue' });
    } catch (error) {
        console.error('Error updating notification:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
};

exports.markAllAsRead = async (req, res) => {
    try {
        const userId = req.body.userId;
        if (!userId) return res.status(400).json({ success: false, message: 'User ID required' });

        await Notif.update(
            { is_read: true, read_at: new Date() },
            { where: { user_recep: userId, is_read: false } }
        );

        res.status(200).json({ success: true, message: 'Toutes les notifications marquées comme lues' });
    } catch (error) {
        console.error('Error updating notifications:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
};
