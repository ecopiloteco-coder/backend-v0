const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Projet = sequelize.define('projet', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    Nom_Projet: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Date_Limite: {
        type: DataTypes.DATEONLY,
        allowNull: true
    },
    Ajouté_par: {
        type: DataTypes.INTEGER,
        allowNull: true  // Allow null to avoid FK constraint errors
    },
    Description: {
        type: DataTypes.STRING,
        allowNull: true
    },
    adresse: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Cout: {
        type: DataTypes.FLOAT,
        allowNull: true
    },
    Date_Debut: {
        type: DataTypes.DATEONLY,
        allowNull: true
    },
    client: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'clients',
            key: 'id'
        }
    },
    file: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    prix_vente: {
        type: DataTypes.FLOAT,
        allowNull: true
    },
    etat: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    tableName: 'projets',
    schema: 'public',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false // The schema doesn't show updated_at for projets
});

module.exports = Projet;
