const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Niveau4 = sequelize.define('niveau_4', {
    id_niveau_4: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    niveau_4: {
        type: DataTypes.STRING,
        allowNull: true
    },
    id_niv_3: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'niveau_3',
            key: 'id_niveau_3'
        }
    }
}, {
    tableName: 'niveau_4',
    schema: 'public'
});

module.exports = Niveau4;
