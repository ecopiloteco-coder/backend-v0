const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Niveau3 = sequelize.define('niveau_3', {
    id_niveau_3: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    niveau_3: {
        type: DataTypes.STRING,
        allowNull: true
    },
    id_niv_2: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'niveau_2',
            key: 'id_niveau_2'
        }
    }
}, {
    tableName: 'niveau_3',
    schema: 'public'
});

module.exports = Niveau3;
