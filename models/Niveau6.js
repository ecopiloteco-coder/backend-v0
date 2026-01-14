const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Niveau6 = sequelize.define('niveau_6', {
    id_niveau_6: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    niveau_6: {
        type: DataTypes.STRING,
        allowNull: true
    },
    id_niv_5: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'niveau_5',
            key: 'id_niveau_5'
        }
    },
    id_niv_4: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'niveau_4',
            key: 'id_niveau_4'
        }
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
    tableName: 'niveau_6',
    schema: 'public'
});

module.exports = Niveau6;
