const pool = require('../../config/db');
const { buildLotNameSelect } = require('../utils/lotHelper');

// Direct LOT_JOIN for events table using the lot column
const LOT_JOIN = 'LEFT JOIN niveau_2 lot_niv2 ON lot_niv2.id_niveau_2 = e.lot';
const LOT_NAME_SELECT = buildLotNameSelect('lot_niv2');

class Notification {
    /**
     * Create notification for a user
     */
    static async create({ eventId, userId, isRead = false }) {
        const query = `
            INSERT INTO notifs (event, user_recep, is_read, created_at)
            VALUES ($1, $2, $3, NOW())
            RETURNING id_notif, event, user_recep, is_read, created_at, read_at
        `;

        const result = await pool.query(query, [eventId, userId, isRead]);
        return result.rows[0];
    }

    /**
     * Create notifications for multiple users
     */
    static async createForUsers(eventId, userIds) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const notifications = [];
            for (const userId of userIds) {
                // Get the next ID for this notification
                const maxIdResult = await client.query('SELECT COALESCE(MAX(id_notif), 0) + 1 as next_id FROM notifs');
                const nextId = maxIdResult.rows[0].next_id;

                const query = `
                    INSERT INTO notifs (id_notif, event, user_recep, is_read, created_at)
                    VALUES ($1, $2, $3, false, NOW())
                    RETURNING id_notif, event, user_recep, is_read, created_at, read_at
                `;
                const result = await client.query(query, [nextId, eventId, userId]);
                notifications.push(result.rows[0]);
            }

            await client.query('COMMIT');
            return notifications;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get notifications for a user
     */
    static async findByUser(userId, { limit = 50, offset = 0, unreadOnly = false } = {}) {
        let query = `
            SELECT 
                n.id_notif,
                n.event as event_id,
                n.user_recep as user_id,
                n.is_read,
                n.created_at,
                n.read_at,
                e.action,
                e.metadata,
                ${LOT_NAME_SELECT},
                e."user" as actor_id,
                e.lot,
                e.projet as project_id,
                e.article as article_id,
                e.bloc as bloc_id,
                e.ouvrage as gbloc_id,
                e.bloc_nom_anc as bloc_nom,
                e.ouvrage_nom_anc as gbloc_nom,
                u.nom_utilisateur as actor_name,
                u.email as actor_email,
                p."Nom_Projet" as project_name,
                b.nom_bloc,
                o.nom_ouvrage as nom_gbloc
            FROM notifs n
            INNER JOIN events e ON n.event = e.id_event
            ${LOT_JOIN}
            LEFT JOIN users u ON e."user" = u.id
            LEFT JOIN projets p ON e.projet = p.id
            LEFT JOIN bloc b ON e.bloc = b.id
            LEFT JOIN ouvrage o ON e.ouvrage = o.id
            WHERE n.user_recep = $1
        `;

        const params = [userId];

        if (unreadOnly) {
            query += ` AND n.is_read = false`;
        }

        query += ` ORDER BY n.created_at DESC LIMIT $2 OFFSET $3`;
        params.push(limit, offset);

        const result = await pool.query(query, params);
        return result.rows.map(row => {
            const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
            // Use stored bloc_nom/gbloc_nom first, fallback to joined values
            const finalBlocNom = row.bloc_nom || row.nom_bloc;
            const finalGblocNom = row.gbloc_nom || row.nom_gbloc;

            // Enrich metadata with bloc/gbloc names
            if (finalBlocNom && !metadata.bloc_nom) {
                metadata.bloc_nom = finalBlocNom;
            }
            if (finalGblocNom && !metadata.gbloc_name) {
                metadata.gbloc_name = finalGblocNom;
            }
            // Ensure lot_name present for frontend rendering
            if (row.lot_name && !metadata.lot_name) {
                metadata.lot_name = row.lot_name;
            }
            return {
                ...row,
                metadata,
                bloc_nom: finalBlocNom,
                gbloc_nom: finalGblocNom,
                lot_name: row.lot_name || null
            };
        });
    }

    /**
     * Get unread count for a user
     */
    static async getUnreadCount(userId) {
        const query = `
            SELECT COUNT(*) as count
            FROM notifs
            WHERE user_recep = $1 AND is_read = false
        `;

        const result = await pool.query(query, [userId]);
        return parseInt(result.rows[0].count, 10);
    }

    /**
     * Mark notification as read
     */
    static async markAsRead(notificationId, userId) {
        const query = `
            UPDATE notifs
            SET is_read = true, read_at = NOW()
            WHERE id_notif = $1 AND user_recep = $2
            RETURNING id_notif, event, user_recep, is_read, created_at, read_at
        `;

        const result = await pool.query(query, [notificationId, userId]);
        return result.rows[0] || null;
    }

    /**
     * Mark all notifications as read for a user
     */
    static async markAllAsRead(userId, projectId = null) {
        let query = `
            UPDATE notifs n
            SET is_read = true, read_at = NOW()
            WHERE n.user_recep = $1 AND n.is_read = false
        `;

        const params = [userId];

        if (projectId) {
            query += ` AND EXISTS (
                SELECT 1 FROM events e 
                WHERE e.id_event = n.event AND e.projet = $2
            )`;
            params.push(projectId);
        }

        query += ` RETURNING id_notif`;

        const result = await pool.query(query, params);
        return result.rows.length;
    }

    /**
     * Delete notification
     */
    static async delete(notificationId, userId) {
        const query = `
            DELETE FROM notifs
            WHERE id_notif = $1 AND user_recep = $2
            RETURNING id_notif
        `;

        const result = await pool.query(query, [notificationId, userId]);
        return result.rows.length > 0;
    }

    /**
     * Delete old notifications (cleanup)
     * @param {number} minutes - Retention in minutes (default 60 days / 86400 minutes)
     */
    static async deleteOlderThan(minutes = 60 * 24 * 60) {
        const query = `
            DELETE FROM notifs
            WHERE created_at < NOW() - INTERVAL '${minutes} minutes'
            RETURNING id_notif
        `;

        const result = await pool.query(query);
        return result.rows.length;
    }

    /**
     * Get notifications by project for a user
     */
    static async findByProjectAndUser(projectId, userId, { limit = 50, offset = 0 } = {}) {
        const query = `
            SELECT 
                n.id_notif,
                n.event as event_id,
                n.user_recep as user_id,
                n.is_read,
                n.created_at,
                n.read_at,
                e.action,
                e.metadata,
                ${LOT_NAME_SELECT},
                e."user" as actor_id,
                e.lot,
                e.projet as project_id,
                e.article as article_id,
                e.bloc as bloc_id,
                e.ouvrage as gbloc_id,
                e.bloc_nom_anc as bloc_nom,
                e.ouvrage_nom_anc as gbloc_nom,
                u.nom_utilisateur as actor_name,
                u.email as actor_email,
                p."Nom_Projet" as project_name,
                b.nom_bloc,
                o.nom_ouvrage as nom_gbloc
            FROM notifs n
            INNER JOIN events e ON n.event = e.id_event
            ${LOT_JOIN}
            LEFT JOIN users u ON e."user" = u.id
            LEFT JOIN projets p ON e.projet = p.id
            LEFT JOIN bloc b ON e.bloc = b.id
            LEFT JOIN ouvrage o ON e.ouvrage = o.id
            WHERE n.user_recep = $1 AND e.projet = $2
            ORDER BY n.created_at DESC
            LIMIT $3 OFFSET $4
        `;

        const result = await pool.query(query, [userId, projectId, limit, offset]);
        return result.rows.map(row => {
            const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
            // Use stored bloc_nom/gbloc_nom first, fallback to joined values
            const finalBlocNom = row.bloc_nom || row.nom_bloc;
            const finalGblocNom = row.gbloc_nom || row.nom_gbloc;

            // Enrich metadata with bloc/gbloc names
            if (finalBlocNom && !metadata.bloc_nom) {
                metadata.bloc_nom = finalBlocNom;
            }
            if (finalGblocNom && !metadata.gbloc_name) {
                metadata.gbloc_name = finalGblocNom;
            }
            // Ensure lot_name present for frontend rendering
            if (row.lot_name && !metadata.lot_name) {
                metadata.lot_name = row.lot_name;
            }
            return {
                ...row,
                metadata,
                bloc_nom: finalBlocNom,
                gbloc_nom: finalGblocNom,
                lot_name: row.lot_name || null
            };
        });
    }
}

module.exports = Notification;
