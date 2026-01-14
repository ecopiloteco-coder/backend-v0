const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ArticleSupprime = sequelize.define('articles_supprime', {
    ID: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    Date: {
        type: DataTypes.DATEONLY,
        allowNull: true
    },
    nom_article: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'This represents Niveau 7 in the hierarchy'
    },
    Unite: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Type: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Expertise: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Fourniture: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Cadence: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Accessoires: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Pertes: {
        type: DataTypes.STRING,
        allowNull: true
    },
    PU: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Prix Unitaire'
    },
    Prix_Cible: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Prix_estime: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Prix_consulte: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Rabais: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Commentaires: {
        type: DataTypes.STRING,
        allowNull: true
    },
    User: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    Indice_de_confiance: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    files: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    deleted_by: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Email or name of the admin who deleted this article'
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
    }
}, {
    tableName: 'articles_supprime',
    schema: 'public',
    timestamps: false
});

module.exports = ArticleSupprime;
