const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ProjetArticle = sequelize.define('ProjetArticle', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    article: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'articles',
            key: 'ID'
        }
    },
    quantite: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    prix_total_ht: {
        type: DataTypes.FLOAT,
        allowNull: true
    },
    tva: {
        type: DataTypes.FLOAT,
        allowNull: true
    },
    total_ttc: {
        type: DataTypes.FLOAT,
        allowNull: true
    },
    localisation: {
        type: DataTypes.STRING,
        allowNull: true
    },
    description: {
        type: DataTypes.STRING,
        allowNull: true
    },
    nouv_prix: {
        type: DataTypes.FLOAT,
        allowNull: true
    },
    designation_article: {
        type: DataTypes.STRING,
        allowNull: true
    },
    structure: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'structure',
            key: 'id_structure'
        }
    }
}, {
    tableName: 'projet_article',
    schema: 'public',
    timestamps: false
});

module.exports = ProjetArticle;
