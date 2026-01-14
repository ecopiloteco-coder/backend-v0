const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Niveau1 = sequelize.define('niveau_1', {
    id_niveau_1: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    niveau_1: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    tableName: 'niveau_1',
    schema: 'public'
});

module.exports = Niveau1;
