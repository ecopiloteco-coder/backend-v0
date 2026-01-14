const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Niveau5 = sequelize.define('niveau_5', {
    id_niveau_5: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    niveau_5: {
        type: DataTypes.STRING,
        allowNull: true
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
    tableName: 'niveau_5',
    schema: 'public'
});

module.exports = Niveau5;
