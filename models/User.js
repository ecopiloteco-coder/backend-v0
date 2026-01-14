const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const User = sequelize.define('users', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    nom_utilisateur: {
        type: DataTypes.STRING,
        allowNull: false
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    titre_poste: {
        type: DataTypes.STRING,
        allowNull: false
    },
    mot_de_passe: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    date_creation_compte: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    is_admin: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
}, {
    tableName: 'users',
    schema: 'public'
});

module.exports = User;
