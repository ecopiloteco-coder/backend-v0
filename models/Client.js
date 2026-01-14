const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Client = sequelize.define('client', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    nom_client: {
        type: DataTypes.STRING,
        allowNull: true
    },
    marge_brut: {
        type: DataTypes.REAL,
        allowNull: true
    },
    marge_net: {
        type: DataTypes.REAL,
        allowNull: true
    },
    agence: {
        type: DataTypes.STRING,
        allowNull: true
    },
    responsable: {
        type: DataTypes.STRING,
        allowNull: true
    },
    effectif_chantier: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    tableName: 'client',
    schema: 'public',
    timestamps: false
});

module.exports = Client;
