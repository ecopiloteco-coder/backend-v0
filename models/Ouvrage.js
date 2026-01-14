const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Ouvrage = sequelize.define('Ouvrage', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    nom_ouvrage: {
        type: DataTypes.STRING,
        allowNull: true
    },
    prix_total: {
        type: DataTypes.FLOAT,
        allowNull: true
    },
    designation: {
        type: DataTypes.STRING,
        allowNull: true
    },
    projet_lot: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'projet_lot',
            key: 'id_projet_lot'
        }
    }
}, {
    tableName: 'ouvrage',
    schema: 'public',
    timestamps: false
});

module.exports = Ouvrage;
