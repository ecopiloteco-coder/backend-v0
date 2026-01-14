const { sequelize } = require('../config/database');

// Import all models
const Niveau1 = require('./Niveau1');
const Niveau2 = require('./Niveau2');
const Niveau3 = require('./Niveau3');
const Niveau4 = require('./Niveau4');
const Niveau5 = require('./Niveau5');
const Niveau6 = require('./Niveau6');
const Article = require('./Article');
const ArticleSupprime = require('./ArticleSupprime');
const PendingArticle = require('./PendingArticle');
const Fournisseur = require('./Fournisseur');
const User = require('./User');
const Client = require('./Client');
const Projet = require('./Projet');
const ProjetLot = require('./ProjetLot');
const Ouvrage = require('./Ouvrage');
const Bloc = require('./Bloc');
const Structure = require('./Structure');
const ProjetArticle = require('./ProjetArticle');
const ProjetEquipe = require('./ProjetEquipe');
const Event = require('./Event');
const Notif = require('./Notif');

// Define associations
// Niveau 1 -> Niveau 2
Niveau1.hasMany(Niveau2, {
    foreignKey: 'id_niv_1',
    as: 'niveau2s'
});
Niveau2.belongsTo(Niveau1, {
    foreignKey: 'id_niv_1',
    as: 'niveau1'
});

// Niveau 2 -> Niveau 3
Niveau2.hasMany(Niveau3, {
    foreignKey: 'id_niv_2',
    as: 'niveau3s'
});
Niveau3.belongsTo(Niveau2, {
    foreignKey: 'id_niv_2',
    as: 'niveau2'
});

// Niveau 3 -> Niveau 4
Niveau3.hasMany(Niveau4, {
    foreignKey: 'id_niv_3',
    as: 'niveau4s'
});
Niveau4.belongsTo(Niveau3, {
    foreignKey: 'id_niv_3',
    as: 'niveau3'
});

// Niveau 4 -> Niveau 5
Niveau4.hasMany(Niveau5, {
    foreignKey: 'id_niv_4',
    as: 'niveau5s'
});
Niveau5.belongsTo(Niveau4, {
    foreignKey: 'id_niv_4',
    as: 'niveau4'
});

// Niveau 3 -> Niveau 5 (alternative path)
Niveau3.hasMany(Niveau5, {
    foreignKey: 'id_niv_3',
    as: 'niveau5s_direct'
});
Niveau5.belongsTo(Niveau3, {
    foreignKey: 'id_niv_3',
    as: 'niveau3'
});

// Niveau 5 -> Niveau 6
Niveau5.hasMany(Niveau6, {
    foreignKey: 'id_niv_5',
    as: 'niveau6s'
});
Niveau6.belongsTo(Niveau5, {
    foreignKey: 'id_niv_5',
    as: 'niveau5'
});

// Niveau 4 -> Niveau 6 (alternative path)
Niveau4.hasMany(Niveau6, {
    foreignKey: 'id_niv_4',
    as: 'niveau6s_direct'
});
Niveau6.belongsTo(Niveau4, {
    foreignKey: 'id_niv_4',
    as: 'niveau4'
});

// Niveau 3 -> Niveau 6 (alternative path)
Niveau3.hasMany(Niveau6, {
    foreignKey: 'id_niv_3',
    as: 'niveau6s_direct'
});
Niveau6.belongsTo(Niveau3, {
    foreignKey: 'id_niv_3',
    as: 'niveau3'
});

// Niveau 6 -> Article
Niveau6.hasMany(Article, {
    foreignKey: 'id_niv_6',
    as: 'articles'
});
Article.belongsTo(Niveau6, {
    foreignKey: 'id_niv_6',
    as: 'niveau6'
});

// User -> Article
User.hasMany(Article, {
    foreignKey: 'User',
    as: 'articles'
});
Article.belongsTo(User, {
    foreignKey: 'User',
    as: 'user'
});

// Fournisseur -> Article
Fournisseur.hasMany(Article, {
    foreignKey: 'fournisseur',
    as: 'articles'
});
Article.belongsTo(Fournisseur, {
    foreignKey: 'fournisseur',
    as: 'fournisseurData'
});

// PendingArticle associations
User.hasMany(PendingArticle, {
    foreignKey: 'created_by',
    as: 'pendingArticles'
});
PendingArticle.belongsTo(User, {
    foreignKey: 'created_by',
    as: 'creator'
});

Niveau6.hasMany(PendingArticle, {
    foreignKey: 'id_niv_6',
    as: 'pendingArticles'
});
PendingArticle.belongsTo(Niveau6, {
    foreignKey: 'id_niv_6',
    as: 'niveau6'
});

Fournisseur.hasMany(PendingArticle, {
    foreignKey: 'fournisseur',
    as: 'pendingArticles'
});
PendingArticle.belongsTo(Fournisseur, {
    foreignKey: 'fournisseur',
    as: 'fournisseurData'
});

Article.hasOne(PendingArticle, {
    foreignKey: 'approved_article_id',
    as: 'pendingArticle'
});
PendingArticle.belongsTo(Article, {
    foreignKey: 'approved_article_id',
    as: 'approvedArticle'
});

// Projet associations
Projet.belongsTo(Client, {
    foreignKey: 'client',
    as: 'clientData'
});
Projet.belongsTo(User, {
    foreignKey: 'Ajouté_par',
    as: 'creator'
});
Client.hasMany(Projet, {
    foreignKey: 'client',
    as: 'projets'
});
User.hasMany(Projet, {
    foreignKey: 'Ajouté_par',
    as: 'projets'
});

// Projet -> ProjetLot
Projet.hasMany(ProjetLot, {
    foreignKey: 'id_projet',
    as: 'lots'
});
ProjetLot.belongsTo(Projet, {
    foreignKey: 'id_projet',
    as: 'projet'
});

// ProjetLot -> Niveau2 (Lot definition)
ProjetLot.belongsTo(Niveau2, {
    foreignKey: 'id_lot',
    as: 'lotData'
});

// ProjetLot -> Ouvrage
ProjetLot.hasMany(Ouvrage, {
    foreignKey: 'projet_lot',
    as: 'ouvrages'
});
Ouvrage.belongsTo(ProjetLot, {
    foreignKey: 'projet_lot',
    as: 'lot'
});

// Ouvrage -> Bloc
Ouvrage.hasMany(Bloc, {
    foreignKey: 'ouvrage',
    as: 'blocs'
});
Bloc.belongsTo(Ouvrage, {
    foreignKey: 'ouvrage',
    as: 'ouvrageData'
});

// Ouvrage -> Structure (Direct articles under Ouvrage)
Ouvrage.hasMany(Structure, {
    foreignKey: 'ouvrage',
    as: 'structures'
});
Structure.belongsTo(Ouvrage, {
    foreignKey: 'ouvrage',
    as: 'ouvrageData'
});

// Bloc -> Structure (Articles under Bloc)
Bloc.hasMany(Structure, {
    foreignKey: 'bloc',
    as: 'structures'
});
Structure.belongsTo(Bloc, {
    foreignKey: 'bloc',
    as: 'blocData'
});

// Structure -> ProjetArticle
Structure.hasMany(ProjetArticle, {
    foreignKey: 'structure',
    as: 'articles'
});
ProjetArticle.belongsTo(Structure, {
    foreignKey: 'structure',
    as: 'structureData'
});

// ProjetArticle -> Article (Reference to catalog)
ProjetArticle.belongsTo(Article, {
    foreignKey: 'article',
    as: 'articleData'
});

// ProjetEquipe associations (Many-to-Many: Projet <-> User)
Projet.hasMany(ProjetEquipe, {
    foreignKey: 'projet',
    as: 'teamMembers'
});
ProjetEquipe.belongsTo(Projet, {
    foreignKey: 'projet',
    as: 'projetData'
});
ProjetEquipe.belongsTo(User, {
    foreignKey: 'equipe',
    as: 'userData'
});
User.hasMany(ProjetEquipe, {
    foreignKey: 'equipe',
    as: 'projectAssignments'
});

// Event associations
Event.belongsTo(User, {
    foreignKey: 'user',
    as: 'userData'
});
Event.belongsTo(Projet, {
    foreignKey: 'projet',
    as: 'projetData'
});
Event.belongsTo(Article, {
    foreignKey: 'article',
    as: 'articleData'
});
Event.belongsTo(Bloc, {
    foreignKey: 'bloc',
    as: 'blocData'
});
Event.belongsTo(Ouvrage, {
    foreignKey: 'ouvrage',
    as: 'ouvrageData'
});
Event.belongsTo(Niveau2, {
    foreignKey: 'lot',
    as: 'lotData'
});

// Notif associations
Notif.belongsTo(Event, {
    foreignKey: 'event',
    as: 'eventData'
});
Notif.belongsTo(User, {
    foreignKey: 'user_recep',
    as: 'recipientData'
});
Event.hasMany(Notif, {
    foreignKey: 'event',
    as: 'notifications'
});
User.hasMany(Notif, {
    foreignKey: 'user_recep',
    as: 'notifications'
});

// Notification Hook
Event.afterCreate(async (event, options) => {
    try {
        const actorId = event.user;
        if (!actorId) return;

        const actor = await User.findByPk(actorId, { transaction: options.transaction });
        if (!actor) return;

        const projectId = event.projet;
        let recipients = [];

        // 1. Notify Project Team Members (for both Admin and User actions)
        if (projectId) {
            const teamMembers = await ProjetEquipe.findAll({
                where: { projet: projectId },
                transaction: options.transaction
            });
            const teamIds = teamMembers.map(tm => tm.equipe);
            recipients.push(...teamIds);
        }

        // 2. If User action, also notify all Admins (for oversight)
        if (!actor.is_admin) {
            const admins = await User.findAll({
                where: { is_admin: true },
                transaction: options.transaction
            });
            const adminIds = admins.map(a => a.id);
            recipients.push(...adminIds);
        }

        recipients = [...new Set(recipients)].filter(uid => uid && uid !== actorId); // Deduplicate and remove actor

        if (recipients.length > 0) {
            // Generate manual IDs for Notifs
            const [maxIdResult] = await sequelize.query(
                `SELECT COALESCE(MAX(id_notif), 0) as max_id FROM notifs`,
                { transaction: options.transaction }
            );
            let nextId = (maxIdResult[0].max_id || 0) + 1;

            const notifsData = recipients.map(uid => ({
                id_notif: nextId++,
                event: event.id_event,
                user_recep: uid,
                is_read: false,
                created_at: new Date(),
                nbr: 1
            }));

            await Notif.bulkCreate(notifsData, { transaction: options.transaction });
        }
    } catch (error) {
        console.error('Error creating notifications:', error);
    }
});

// Export all models
module.exports = {
    sequelize,
    Niveau1,
    Niveau2,
    Niveau3,
    Niveau4,
    Niveau5,
    Niveau6,
    Article,
    ArticleSupprime,
    PendingArticle,
    Fournisseur,
    User,
    Client,
    Projet,
    ProjetEquipe,
    ProjetLot,
    Ouvrage,
    Bloc,
    Structure,
    ProjetArticle,
    Event,
    Notif
};
