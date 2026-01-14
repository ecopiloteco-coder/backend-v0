const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Fournisseur = sequelize.define('fournisseur', {
    id_fournisseur: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    nom_fournisseur: {
        type: DataTypes.STRING,
        allowNull: true
    },
    type: {
        type: DataTypes.STRING,
        allowNull: true
    },
    categorie: {
        type: DataTypes.STRING,
        allowNull: true
    },
    adresse: {
        type: DataTypes.STRING,
        allowNull: true
    },
    telephone: {
        type: DataTypes.STRING,
        allowNull: true
    },
    email: {
        type: DataTypes.STRING,
        allowNull: true
    },
    URL: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    tableName: 'fournisseur',
    schema: 'public'
});

module.exports = Fournisseur;
