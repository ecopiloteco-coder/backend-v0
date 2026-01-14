const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Bloc = sequelize.define('Bloc', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    nom_bloc: {
        type: DataTypes.STRING,
        allowNull: true
    },
    unite: {
        type: DataTypes.STRING,
        allowNull: true
    },
    quantite: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    pu: {
        type: DataTypes.FLOAT,
        allowNull: true
    },
    pt: {
        type: DataTypes.FLOAT,
        allowNull: true
    },
    designation: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ouvrage: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'ouvrage',
            key: 'id'
        }
    }
}, {
    tableName: 'bloc',
    schema: 'public',
    timestamps: false
});

module.exports = Bloc;
