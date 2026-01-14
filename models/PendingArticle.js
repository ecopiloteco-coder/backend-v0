const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PendingArticle = sequelize.define('pending_articles', {
    ID: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    Date: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    nom_article: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'This represents Niveau 7 in the hierarchy'
    },
    Unite: {
        type: DataTypes.STRING,
        allowNull: false
    },
    Type: {
        type: DataTypes.STRING,
        allowNull: false
    },
    Expertise: {
        type: DataTypes.STRING,
        allowNull: false
    },
    Fourniture: {
        type: DataTypes.DECIMAL,
        allowNull: true,
        defaultValue: 0.00
    },
    Cadence: {
        type: DataTypes.DECIMAL,
        allowNull: true,
        defaultValue: 0.00
    },
    Accessoires: {
        type: DataTypes.DECIMAL,
        allowNull: true,
        defaultValue: 0.00
    },
    Pertes: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: '0%'
    },
    PU: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Prix Unitaire'
    },
    Prix_Cible: {
        type: DataTypes.DECIMAL,
        allowNull: true,
        defaultValue: 0.00
    },
    Prix_estime: {
        type: DataTypes.DECIMAL,
        allowNull: true,
        defaultValue: 0.00
    },
    Prix_consulte: {
        type: DataTypes.DECIMAL,
        allowNull: true,
        defaultValue: 0.00
    },
    Rabais: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: '0%'
    },
    Commentaires: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: ''
    },
    created_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    status: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 'En attente'
    },
    submitted_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: DataTypes.NOW
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    reviewed_by: {
        type: DataTypes.STRING,
        allowNull: true
    },
    reviewed_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    Indice_de_confiance: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 3
    },
    files: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    rejected_by: {
        type: DataTypes.STRING,
        allowNull: true
    },
    fournisseur: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'fournisseur',
            key: 'id_fournisseur'
        }
    },
    id_niv_6: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'niveau_6',
            key: 'id_niveau_6'
        }
    },
    approved_article_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'articles',
            key: 'ID'
        }
    }
}, {
    tableName: 'pending_articles',
    schema: 'public',
    timestamps: false // We're managing timestamps manually
});

module.exports = PendingArticle;
