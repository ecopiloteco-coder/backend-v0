const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Event = sequelize.define('Event', {
    id_event: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    action: {
        type: DataTypes.STRING,
        allowNull: true
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: DataTypes.NOW
    },
    metadata: {
        type: DataTypes.JSON,
        allowNull: true
    },
    user: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    article: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'articles',
            key: 'ID'
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
    ouvrage: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'ouvrage',
            key: 'id'
        }
    },
    bloc_nom_anc: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ouvrage_nom_anc: {
        type: DataTypes.STRING,
        allowNull: true
    },
    projet: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'projets',
            key: 'id'
        }
    },
    lot: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'niveau_2',
            key: 'id_niveau_2'
        }
    }
}, {
    tableName: 'events',
    schema: 'public',
    timestamps: false
});

module.exports = Event;
