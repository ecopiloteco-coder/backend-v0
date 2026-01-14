const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Notif = sequelize.define('Notif', {
    id_notif: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    event: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'events',
            key: 'id_event'
        }
    },
    user_recep: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    is_read: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    read_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    nbr: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
}, {
    tableName: 'notifs',
    schema: 'public',
    timestamps: false
});

module.exports = Notif;
