const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Structure = sequelize.define('Structure', {
    id_structure: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    ouvrage: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'ouvrage',
            key: 'id'
        }
    },
    bloc: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'bloc',
            key: 'id'
        }
    },
    action: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    tableName: 'structure',
    schema: 'public',
    timestamps: false
});

module.exports = Structure;
