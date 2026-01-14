const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ProjetLot = sequelize.define('ProjetLot', {
    id_projet_lot: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    id_projet: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'projets',
            key: 'id'
        }
    },
    id_lot: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'niveau_2',
            key: 'id_niveau_2'
        }
    },
    designation_lot: {
        type: DataTypes.STRING,
        allowNull: true
    },
    prix_total: {
        type: DataTypes.FLOAT,
        allowNull: true
    },
    prix_vente: {
        type: DataTypes.FLOAT,
        allowNull: true
    }
}, {
    tableName: 'projet_lot',
    schema: 'public',
    timestamps: false
});

module.exports = ProjetLot;
