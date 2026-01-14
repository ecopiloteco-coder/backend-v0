const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Niveau2 = sequelize.define('niveau_2', {
    id_niveau_2: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    niveau_2: {
        type: DataTypes.STRING,
        allowNull: true
    },
    id_niv_1: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'niveau_1',
            key: 'id_niveau_1'
        }
    }
}, {
    tableName: 'niveau_2',
    schema: 'public'
});

module.exports = Niveau2;
