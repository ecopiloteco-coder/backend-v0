const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ProjetEquipe = sequelize.define('ProjetEquipe', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    equipe: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'users',
            key: 'id',
        },
    },
    projet: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'projets',
            key: 'id',
        },
    },
}, {
    tableName: 'projet_equipe',
    schema: 'public',
    timestamps: false,
});

module.exports = ProjetEquipe;
