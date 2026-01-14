const Event = require('../models/Event');
const Notification = require('../models/Notification');
const pool = require('../../config/db');
const webpush = require('web-push');

// Configure Web Push with keys from environment
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
    console.log('✅ Web Push configured');
} else {
    console.warn('⚠️ VAPID keys not found. Web Push disabled.');
}

class EventNotificationService {
    /**
     * Helper: Resolve lot name from ID
     */
    static async resolveLotName(lotIdOrName) {
        if (!lotIdOrName) return null;

        // If already a string that's not numeric, return as-is
        if (typeof lotIdOrName === 'string' && !/^\d+$/.test(lotIdOrName)) {
            return lotIdOrName;
        }

        // It's an ID, resolve to name
        const lotId = typeof lotIdOrName === 'number' ? lotIdOrName : parseInt(lotIdOrName, 10);
        if (isNaN(lotId)) return lotIdOrName;

        try {
            // Try niveau_2 column first
            let lotRes = await pool.query('SELECT niveau_2 FROM niveau_2 WHERE id_niveau_2 = $1', [lotId]);
            if (lotRes.rows[0]?.niveau_2) {
                return lotRes.rows[0].niveau_2;
            }

            // Fallback to Niveau_2__lot column
            lotRes = await pool.query('SELECT "Niveau_2__lot" FROM niveau_2 WHERE id_niveau_2 = $1', [lotId]);
            return lotRes.rows[0]?.Niveau_2__lot || String(lotId);
        } catch (error) {
            console.warn('⚠️ Failed to resolve lot name:', error.message);
            return String(lotId);
        }
    }

    /**
     * Get all admins
     */
    static async getAdmins() {
        try {
            const result = await pool.query('SELECT id FROM users WHERE is_admin = true');
            return result.rows.map(row => row.id);
        } catch (e1) {
            try {
                const result = await pool.query(`SELECT id FROM users WHERE role = 'admin'`);
                return result.rows.map(row => row.id);
            } catch (e2) {
                console.error('Error fetching admins:', e2.message);
                return [];
            }
        }
    }

    /**
     * Get project team members and creator
     */
    static async getProjectUsers(projectId) {
        try {
            const query = `
                SELECT DISTINCT u.id
                FROM users u
                WHERE u.id IN (
                    SELECT p."Ajouté_par" FROM projets p WHERE p.id = $1
                    UNION
                    SELECT pe.equipe FROM projet_equipe pe WHERE pe.projet = $1
                )
            `;
            const result = await pool.query(query, [projectId]);
            return result.rows.map(row => ({
                id: row.id,
                muted: false
            }));
        } catch (error) {
            console.error('Error fetching project users:', error.message);
            return [];
        }
    }

    /**
     * Send Web Push Notification to a user
     */
    static async sendWebPush(userId, payload) {
        if (!global.pushSubscriptions || !webpush) return;

        const uid = userId.toString();
        const isConnected = global.activeUsers?.has(uid);

        console.log(`🔔 Checking push for user ${uid}: Connected=${isConnected}`);

        if (!isConnected) {
            console.log(`🔕 Suppressing push for user ${uid} (Offline)`);
            return;
        }

        const subscriptions = global.pushSubscriptions.get(uid);
        if (!subscriptions || subscriptions.length === 0) return;

        const notifications = subscriptions.map(sub => {
            return webpush.sendNotification(sub, JSON.stringify(payload))
                .catch(err => {
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        console.log(`Removing invalid push subscription for user ${uid}`);
                        const current = global.pushSubscriptions.get(uid) || [];
                        const valid = current.filter(s => s.endpoint !== sub.endpoint);
                        if (valid.length > 0) {
                            global.pushSubscriptions.set(uid, valid);
                        } else {
                            global.pushSubscriptions.delete(uid);
                        }
                    } else {
                        console.error('Web Push error:', err.message);
                    }
                });
        });

        await Promise.allSettled(notifications);
    }

    /**
     * Create event and send notifications
     */
    static async createEventAndNotify({
        action,
        metadata = {},
        lot = null,
        userId,
        projectId,
        articleId = null,
        blocId = null,
        gblocId = null,
        blocNom = null,
        gblocNom = null,
        notifyAdmins = false,
        notifyProjectUsers = true,
        isSystemEvent = false  // 🆕 Flag to distinguish system-generated events
    }) {
        try {
            // Create event with automatic name preservation
            const event = await Event.createWithNames({
                action,
                metadata: {
                    ...metadata,
                    isSystemEvent: isSystemEvent || false  // 🆕 Add system event flag to metadata
                },
                lot,
                userId,
                projectId,
                articleId,
                blocId,
                gblocId,
                blocNom,
                gblocNom
            });

            // Determine who to notify
            const notificationTargets = new Set();
            let createdNotifications = null;

            // Fetch admins and project users in parallel
            const [admins, projectUsers] = await Promise.all([
                this.getAdmins(),
                projectId ? this.getProjectUsers(projectId) : Promise.resolve([])
            ]);

            const actorIsAdmin = admins.includes(userId);

            // === TARGETING LOGIC ===

            // 1. Project Team Targets
            projectUsers.forEach(user => {
                if (user.id !== userId && !user.muted) {
                    notificationTargets.add(user.id);
                }
            });

            // 2. Admin Targets
            if (!actorIsAdmin) {
                // Actor is User -> Notify Admins
                admins.forEach(adminId => {
                    if (adminId !== userId) {
                        const adminInTeam = projectUsers.find(u => u.id === adminId);
                        if (!adminInTeam || !adminInTeam.muted) {
                            notificationTargets.add(adminId);
                        }
                    }
                });
            }

            // Ensure actor is never notified
            notificationTargets.delete(userId);

            console.log(`📢 Notification targets for action ${action}:`, Array.from(notificationTargets));

            // Create notifications
            if (notificationTargets.size > 0) {
                try {
                    createdNotifications = await Notification.createForUsers(
                        event.id_event,
                        Array.from(notificationTargets)
                    );
                } catch (notificationError) {
                    console.log('Notification creation error:', notificationError.message);
                }
            }

            // 🚨 PREVENT RECURSIVE LOOPS: Only recalculate for user-initiated events
            if (projectId && !isSystemEvent) {
                try {
                    const Project = require('../models/Project');
                    await Project.recalculatePrixVente(projectId);
                    console.log(`✅ Recalculated prix_vente after ${action} for project ${projectId}`);
                } catch (recalcError) {
                    console.error(`❌ Failed to recalculate prix_vente:`, recalcError.message);
                }
            }

            // ✅ AUTOMATIC DESIGNATION RECALCULATION
            const hierarchyActions = new Set([
                'gbloc_created', 'gbloc_updated', 'gbloc_duplicated',
                'bloc_created', 'bloc_created_ouvrage', 'bloc_updated', 'bloc_updated_ouvrage',
                'article_added', 'article_updated',
                'lot_created', 'lot_updated'
            ]);

            // 🚨 PREVENT RECURSIVE LOOPS: Only recalculate designations for user-initiated events
            if (projectId && hierarchyActions.has(action) && !isSystemEvent) {
                const shouldRecalculate = action !== 'gbloc_updated' ||
                    (metadata?.changes?.designation !== undefined);

                if (shouldRecalculate) {
                    process.nextTick(async () => {
                        try {
                            const DesignationHelper = require('../utils/designationHelper');

                            let lotIdForRecalc = null;
                            if (lot) {
                                const resolved = await this.resolveLotName(lot);
                                lotIdForRecalc = resolved;
                            }

                            const targetOuvrageId = gblocId || null;

                            console.log(`🔄 Auto-recalculating designations after ${action}`);

                            await DesignationHelper.recalculateProjectDesignations(
                                projectId,
                                null,
                                null,
                                targetOuvrageId,
                                lotIdForRecalc
                            );

                            console.log(`✅ Designations auto-recalculated for project ${projectId}`);
                        } catch (recalcError) {
                            if (recalcError?.code !== '42501' && recalcError?.code !== '42P01') {
                                console.warn(`⚠️ Auto-designation recalculation failed:`, recalcError.message);
                            }
                        }
                    });
                }
            }

            // Fetch actor and project info for SSE
            let actorName = null;
            let actorEmail = null;
            let projectName = null;

            try {
                const [userResult, projResult] = await Promise.all([
                    pool.query('SELECT nom_utilisateur, email FROM users WHERE id = $1', [userId]),
                    projectId ? pool.query('SELECT "Nom_Projet" AS nom_projet FROM projets WHERE id = $1', [projectId]) : Promise.resolve({ rows: [] })
                ]);

                if (userResult.rows.length > 0) {
                    actorName = userResult.rows[0].nom_utilisateur;
                    actorEmail = userResult.rows[0].email;
                }

                if (projResult.rows.length > 0) {
                    projectName = projResult.rows[0].nom_projet;
                }
            } catch (err) {
                console.error('Error fetching actor/project info:', err.message);
            }

            const baseEventData = {
                id_event: event.id_event,
                action,
                created_at: event.created_at,
                metadata,
                lot,
                user_id: userId,
                user_name: actorName,
                user_email: actorEmail,
                actor_id: userId,
                actor_name: actorName,
                actor_email: actorEmail,
                project_id: projectId,
                project_name: projectName,
                article_id: articleId,
                bloc_id: blocId,
                gbloc_id: gblocId,
                bloc_nom: event.bloc_nom_anc || event.bloc_nom,
                gbloc_nom: event.ouvrage_nom_anc || event.gbloc_nom
            };

            // Send notifications via SSE and Web Push
            const sendToUser = async (targetUserId, extra = {}) => {
                const payload = { ...baseEventData, ...extra, user_id: targetUserId };

                let unreadCount = 0;
                try {
                    unreadCount = await Notification.getUnreadCount(targetUserId);
                } catch (e) {
                    console.error('Error fetching unread count:', e.message);
                }

                // 1. Send via SSE
                const subs = global.userSubscribers?.get(targetUserId.toString());
                if (subs && subs.size > 0) {
                    console.log(`[SSE] Sending to user ${targetUserId} (unread: ${unreadCount})`);
                    subs.forEach((clientRes) => {
                        try {
                            clientRes.write(`event: notification\n`);
                            clientRes.write(`data: ${JSON.stringify(payload)}\n\n`);
                            clientRes.write(`event: count\n`);
                            clientRes.write(`data: ${JSON.stringify({ count: unreadCount })}\n\n`);
                        } catch (err) {
                            console.error('SSE send error:', err.message);
                        }
                    });
                }

                // 2. Send via Web Push
                const actionTranslations = {
                    'project_created': 'Projet créé',
                    'project_updated': 'Projet mis à jour',
                    'article_added': 'Article ajouté',
                    'article_updated': 'Article mis à jour',
                    'article_deleted': 'Article supprimé',
                    'bloc_created': 'Bloc créé',
                    'bloc_updated': 'Bloc mis à jour',
                    'bloc_deleted': 'Bloc supprimé',
                    'gbloc_created': 'Ouvrage créé',
                    'gbloc_updated': 'Ouvrage mis à jour',
                    'gbloc_deleted': 'Ouvrage supprimé',
                    'lot_created': 'Lot créé',
                    'lot_updated': 'Lot mis à jour',
                    'lot_deleted': 'Lot supprimé'
                };

                const rawAction = payload.action || 'notification';
                const actionName = actionTranslations[rawAction] || rawAction.replace(/_/g, ' ');
                const projectTitle = payload.project_name || 'Projet';
                const actor = payload.actor_name || 'Système';

                const detailsParts = [];
                if (payload.metadata?.article_name || payload.metadata?.nom_article) {
                    detailsParts.push(`Article: ${payload.metadata.article_name || payload.metadata.nom_article}`);
                }
                if (payload.bloc_nom) detailsParts.push(`Bloc: ${payload.bloc_nom}`);
                if (payload.gbloc_nom) detailsParts.push(`Ouvrage: ${payload.gbloc_nom}`);
                if (payload.lot) detailsParts.push(`Lot: ${payload.lot}`);

                const description = detailsParts.length > 0
                    ? detailsParts.join(' • ')
                    : `${actor} a effectué : ${actionName}`;

                const pushPayload = {
                    title: `${projectTitle} : ${actionName}`,
                    body: description,
                    icon: '/favicon.ico',
                    data: {
                        url: payload.project_id ? `/admin/project-details/${payload.project_id}` : '/',
                        event_title: actionName,
                        event_description: description,
                        start_date: payload.created_at,
                        venue_name: projectTitle,
                        organizer_name: actor,
                        ...payload
                    },
                    timestamp: new Date(payload.created_at).getTime(),
                    tag: `event-${payload.id_event}`
                };

                await this.sendWebPush(targetUserId, pushPayload);
            };

            // Send to all targets
            if (Array.isArray(createdNotifications) && createdNotifications.length > 0) {
                await Promise.all(createdNotifications.map((n) =>
                    sendToUser(n.user_recep, {
                        id_notif: n.id_notif,
                        is_read: n.is_read,
                        read_at: n.read_at,
                        created_at: n.created_at || event.created_at
                    })
                ));
            } else if (notificationTargets.size > 0) {
                await Promise.all(Array.from(notificationTargets).map((targetId) =>
                    sendToUser(targetId)
                ));
            }

            // Broadcast to projectEvents
            // 🚨 PREVENT RECURSIVE LOOPS: Don't broadcast system-generated events
            if (!isSystemEvent) {
                try {
                    const { projectEvents } = require('../utils/eventBus');
                    let changeType = action;
                    if (action.includes('_')) {
                        const parts = action.split('_');
                        changeType = parts[0] + parts.slice(1).map(part =>
                            part.charAt(0).toUpperCase() + part.slice(1)
                        ).join('');
                    }

                    projectEvents.emit('projectChanged', {
                    projectId,
                    type: changeType,
                    action,
                    payload: {
                        action,
                        gblocId,
                        blocId,
                        articleId,
                        lot,
                        nom_gbloc: event.ouvrage_nom_anc || event.gbloc_nom,
                        nom_bloc: event.bloc_nom_anc || event.bloc_nom,
                        gbloc_name: event.ouvrage_nom_anc || event.gbloc_nom,
                        bloc_name: event.bloc_nom_anc || event.bloc_nom,
                        lot_name: lot,
                        ...metadata
                    },
                    timestamp: Date.now()
                });
                    console.log(`📡 Broadcasted ${action} to projectEvents for project ${projectId}`);
                } catch (eventBusError) {
                    console.warn('⚠️ Failed to broadcast to projectEvents:', eventBusError.message);
                }
            } else {
                console.log(`🚫 Skipped broadcasting system event: ${action} for project ${projectId}`);
            }

            return event;
        } catch (error) {
            console.error('❌ Error in createEventAndNotify:', error);
            throw error;
        }
    }

    /**
     * Create a system-generated event (won't trigger recalculations or broadcasts)
     */
    static async createSystemEvent(params) {
        return this.createEventAndNotify({
            ...params,
            isSystemEvent: true,
            notifyAdmins: false,
            notifyProjectUsers: false
        });
    }

    // ==================== PROJECT EVENTS ====================

    static async projectCreated(projectId, userId, projectData) {
        return this.createEventAndNotify({
            action: 'project_created',
            metadata: {
                project_name: projectData.nom_projet,
                description: projectData.description
            },
            userId,
            projectId,
            notifyAdmins: true,
            notifyProjectUsers: false
        });
    }

    static async projectUpdated(projectId, userId, changes, isUserAction = false) {
        const sanitized = {};
        try {
            if (changes && typeof changes === 'object') {
                for (const [key, val] of Object.entries(changes)) {
                    if (val && typeof val === 'object' && ('to' in val)) {
                        const to = val.to;
                        const from = val.from;
                        const isEmpty = (x) => x === null || x === undefined ||
                            (typeof x === 'string' && x.trim() === '');
                        if (isEmpty(to)) continue;
                        if (from !== undefined && String(from) === String(to)) continue;
                        sanitized[key] = { from, to };
                    }
                }
            }
        } catch (e) {
            Object.assign(sanitized, changes || {});
        }

        if (Object.keys(sanitized).length === 0) {
            return null;
        }

        // Try to merge into recent event (within 5 seconds)
        try {
            const client = await pool.connect();
            try {
                const lastRes = await client.query(
                    `SELECT id_event, metadata, created_at
                     FROM events
                     WHERE projet = $1 AND action = 'project_updated' AND user_id = $2
                     ORDER BY created_at DESC
                     LIMIT 1`,
                    [projectId, userId]
                );
                const last = lastRes.rows[0];
                const now = Date.now();
                if (last) {
                    const createdAt = new Date(last.created_at).getTime();
                    if (isFinite(createdAt) && now - createdAt <= 5000) {
                        const prevMeta = last.metadata || {};
                        const prevChanges = prevMeta.changes || {};
                        const merged = { ...prevChanges, ...sanitized };
                        const newMeta = { ...prevMeta, changes: merged };
                        await client.query(
                            'UPDATE events SET metadata = $1 WHERE id_event = $2',
                            [newMeta, last.id_event]
                        );

                        // Broadcast updated event
                        const subscribers = global.projectSubscribers?.get(projectId.toString());
                        if (subscribers && subscribers.size > 0) {
                            const [userResult, projResult] = await Promise.all([
                                pool.query('SELECT nom_utilisateur, email FROM users WHERE id = $1', [userId]),
                                pool.query('SELECT "Nom_Projet" AS nom_projet FROM projets WHERE id = $1', [projectId])
                            ]);

                            const eventData = {
                                id_event: last.id_event,
                                action: 'project_updated',
                                created_at: last.created_at,
                                metadata: newMeta,
                                user_id: userId,
                                user_name: userResult.rows[0]?.nom_utilisateur,
                                user_email: userResult.rows[0]?.email,
                                project_id: projectId,
                                project_name: projResult.rows[0]?.nom_projet
                            };

                            subscribers.forEach(clientRes => {
                                try {
                                    clientRes.write(`event: notification\n`);
                                    clientRes.write(`data: ${JSON.stringify(eventData)}\n\n`);
                                } catch { }
                            });
                        }

                        return { id_event: last.id_event, action: 'project_updated', metadata: newMeta };
                    }
                }
            } finally {
                client.release();
            }
        } catch (e) {
            console.warn('Failed to merge project updates:', e.message);
        }

        return this.createEventAndNotify({
            action: 'project_updated',
            metadata: { changes: sanitized },
            userId,
            projectId,
            notifyAdmins: false,
            notifyProjectUsers: true
        });
    }

    static async projectDeleted(projectId, userId, projectName) {
        return this.createEventAndNotify({
            action: 'project_deleted',
            metadata: { project_name: projectName },
            userId,
            projectId,
            notifyAdmins: true,
            notifyProjectUsers: true
        });
    }

    static async teamUpdated(projectId, userId, changes) {
        try {
            const added = Array.isArray(changes?.added) ?
                changes.added.filter(n => Number.isFinite(Number(n))).map(Number) : [];
            const removed = Array.isArray(changes?.removed) ?
                changes.removed.filter(n => Number.isFinite(Number(n))).map(Number) : [];
            const allIds = Array.from(new Set([...added, ...removed]));

            let addedNames = [];
            let removedNames = [];

            if (allIds.length > 0) {
                const placeholders = allIds.map((_, i) => `$${i + 1}`).join(',');
                const res = await pool.query(
                    `SELECT id, COALESCE(nom_utilisateur, email) AS name 
                     FROM users WHERE id IN (${placeholders})`,
                    allIds
                );
                const map = new Map(res.rows.map(r => [Number(r.id), r.name]));
                addedNames = added.map(id => map.get(id)).filter(Boolean);
                removedNames = removed.map(id => map.get(id)).filter(Boolean);
            }

            const consolidated = {};
            if (addedNames.length > 0) {
                consolidated.equipe_ajoute = {
                    from: null,
                    to: `${addedNames.join(', ')} a été ajouté`
                };
            }
            if (removedNames.length > 0) {
                consolidated.equipe_retire = {
                    from: null,
                    to: `${removedNames.join(', ')} a été retiré`
                };
            }

            if (Object.keys(consolidated).length === 0) return null;

            return this.projectUpdated(projectId, userId, consolidated, true);
        } catch (e) {
            console.warn('⚠️ Failed to emit team update:', e.message);
            return null;
        }
    }

    // ==================== GBLOC EVENTS ====================

    static async gblocCreated(projectId, gblocId, userId, gblocData) {
        const lotName = await this.resolveLotName(gblocData.lot);

        return this.createEventAndNotify({
            action: 'gbloc_created',
            metadata: {
                gbloc_name: gblocData.nom_ouvrage || gblocData.nom_bloc,
                prix_total: gblocData.prix_total
            },
            lot: lotName,
            userId,
            projectId,
            gblocId,
            gblocNom: gblocData.nom_ouvrage || gblocData.nom_bloc,
            notifyAdmins: false,
            notifyProjectUsers: true
        });
    }

    static async gblocUpdated(projectId, gblocId, userId, changes, oldName = null) {
        let gblocName = null;
        try {
            const ouvrageResult = await pool.query(
                'SELECT nom_ouvrage FROM ouvrage WHERE id = $1',
                [gblocId]
            );
            if (ouvrageResult.rows.length > 0) {
                gblocName = ouvrageResult.rows[0].nom_ouvrage;
            }
        } catch (error) {
            console.warn('Error fetching ouvrage name:', error.message);
        }

        const enrichedChanges = { ...changes };
        if (changes.nom_ouvrage && oldName && oldName !== changes.nom_ouvrage) {
            enrichedChanges.old_name = oldName;
            enrichedChanges.new_name = changes.nom_ouvrage;
        }

        return this.createEventAndNotify({
            action: 'gbloc_updated',
            metadata: {
                changes: enrichedChanges,
                gbloc_name: gblocName
            },
            userId,
            projectId,
            gblocId,
            gblocNom: gblocName,
            notifyAdmins: false,
            notifyProjectUsers: true
        });
    }

    static async gblocDeleted(projectId, gblocId, userId, gblocName, lot = null) {
        const lotName = await this.resolveLotName(lot);

        return this.createEventAndNotify({
            action: 'gbloc_deleted',
            metadata: { gbloc_name: gblocName },
            lot: lotName,
            userId,
            projectId,
            gblocId: null,
            gblocNom: gblocName,
            notifyAdmins: false,
            notifyProjectUsers: true
        });
    }

    static async gblocDuplicated(projectId, sourceGblocId, newGblocId, userId, sourceGblocName, newGblocName, lotName = null) {
        const resolvedLotName = await this.resolveLotName(lotName);

        return this.createEventAndNotify({
            action: 'gbloc_duplicated',
            metadata: {
                source_gbloc_name: sourceGblocName,
                new_gbloc_name: newGblocName
            },
            lot: resolvedLotName,
            userId,
            projectId,
            gblocId: newGblocId,
            gblocNom: newGblocName,
            notifyAdmins: false,
            notifyProjectUsers: true
        });
    }

    // ==================== BLOC EVENTS ====================

    static async blocCreated(projectId, blocId, userId, blocData) {
        console.log('🔍 blocCreated called:', { projectId, blocId, userId, blocData });

        let resolvedGblocId = blocData.g_bloc || blocData.ouvrage || null;
        let resolvedGblocName = blocData.gbloc_name || null;

        try {
            if (!resolvedGblocId && blocId) {
                const byBloc = await pool.query(
                    'SELECT s.ouvrage FROM projet_article pa INNER JOIN structure s ON s.id_structure = pa.structure INNER JOIN ouvrage o ON o.id = s.ouvrage INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot WHERE pl.id_projet = $1 AND s.bloc = $2 AND s.ouvrage IS NOT NULL LIMIT 1',
                    [projectId, blocId]
                );
                resolvedGblocId = byBloc.rows[0]?.ouvrage || null;
            }
            if (resolvedGblocId && !resolvedGblocName) {
                const ores = await pool.query(
                    'SELECT nom_ouvrage FROM ouvrage WHERE id = $1',
                    [resolvedGblocId]
                );
                resolvedGblocName = ores.rows[0]?.nom_ouvrage || null;
            }
        } catch (e) {
            console.error('❌ Error during gbloc resolution:', e.message);
        }

        const hasGbloc = !!resolvedGblocId;
        const finalAction = hasGbloc ? 'bloc_created_ouvrage' : 'bloc_created';
        const lotName = await this.resolveLotName(blocData.lot);

        return this.createEventAndNotify({
            action: finalAction,
            metadata: {
                bloc_name: blocData.nom_bloc,
                unite: blocData.unite,
                quantite: blocData.quantite,
                gbloc_name: resolvedGblocName
            },
            lot: lotName,
            userId,
            projectId,
            blocId,
            gblocId: resolvedGblocId,
            gblocNom: resolvedGblocName,
            notifyAdmins: false,
            notifyProjectUsers: true
        });
    }

    static async blocUpdated(projectId, blocId, userId, changes, gblocId = null, lotName = null) {
        console.log('🔍 blocUpdated called:', { projectId, blocId, userId, gblocId, lotName });

        let resolvedGblocId = gblocId || null;
        let resolvedGblocName = null;

        try {
            if (!resolvedGblocId && blocId) {
                const byBloc = await pool.query(
                    'SELECT s.ouvrage FROM projet_article pa INNER JOIN structure s ON s.id_structure = pa.structure INNER JOIN ouvrage o ON o.id = s.ouvrage INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot WHERE pl.id_projet = $1 AND s.bloc = $2 AND s.ouvrage IS NOT NULL LIMIT 1',
                    [projectId, blocId]
                );
                resolvedGblocId = byBloc.rows[0]?.ouvrage || null;
            }
            if (!resolvedGblocId && lotName) {
                const byLot = await pool.query(
                    'SELECT s.ouvrage FROM projet_article pa INNER JOIN structure s ON s.id_structure = pa.structure INNER JOIN ouvrage o ON o.id = s.ouvrage INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot WHERE pl.id_projet = $1 AND pl.id_lot = $2 AND s.ouvrage IS NOT NULL LIMIT 1',
                    [projectId, lotName]
                );
                resolvedGblocId = byLot.rows[0]?.ouvrage || null;
            }
            if (resolvedGblocId) {
                const ores = await pool.query(
                    'SELECT nom_ouvrage FROM ouvrage WHERE id = $1',
                    [resolvedGblocId]
                );
                resolvedGblocName = ores.rows[0]?.nom_ouvrage || null;
            }
        } catch (e) {
            console.error('❌ Error during gbloc resolution:', e.message);
        }

        const hasGbloc = !!resolvedGblocId;
        const finalAction = hasGbloc ? 'bloc_updated_ouvrage' : 'bloc_updated';

        const meta = { changes, gbloc_name: resolvedGblocName };
        try {
            if (blocId) {
                const bres = await pool.query(
                    'SELECT unite, quantite, pu FROM bloc WHERE id = $1',
                    [blocId]
                );
                const b = bres.rows[0] || {};
                if (b.unite != null && String(b.unite).trim() !== '') meta.unite = b.unite;
                if (b.quantite != null) meta.quantite = b.quantite;
                if (b.pu != null && b.pu > 0) meta.pu = b.pu;
            }
        } catch (e) {
            console.warn('⚠️ Failed to enrich blocUpdated:', e.message);
        }

        const resolvedLotName = await this.resolveLotName(lotName);

        return this.createEventAndNotify({
            action: finalAction,
            metadata: meta,
            lot: resolvedLotName,
            userId,
            projectId,
            blocId,
            gblocId: resolvedGblocId,
            gblocNom: resolvedGblocName,
            notifyAdmins: false,
            notifyProjectUsers: true
        });
    }

    static async blocDeleted(projectId, blocId, userId, blocName, lot = null, gblocId = null) {
        let resolvedGblocId = gblocId;
        let gblocName = null;
        let lotName = lot;

        try {
            if (!resolvedGblocId) {
                const res = await pool.query(
                    'SELECT DISTINCT s.ouvrage as ouvrage, pl.id_lot as lot FROM projet_article pa INNER JOIN structure s ON s.id_structure = pa.structure INNER JOIN ouvrage o ON o.id = s.ouvrage INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot WHERE pl.id_projet = $1 AND s.bloc = $2 AND s.ouvrage IS NOT NULL LIMIT 1',
                    [projectId, blocId]
                );
                if (res.rows.length > 0) {
                    resolvedGblocId = res.rows[0]?.ouvrage || null;
                    lotName = lotName || res.rows[0]?.lot || null;
                }
            }

            // Resolve lot name
            lotName = await this.resolveLotName(lotName);

            // Get ouvrage name
            if (resolvedGblocId) {
                const ouvrageRes = await pool.query(
                    'SELECT nom_ouvrage FROM ouvrage WHERE id = $1',
                    [resolvedGblocId]
                );
                if (ouvrageRes.rows.length > 0) {
                    gblocName = ouvrageRes.rows[0]?.nom_ouvrage || null;
                }
            }
        } catch (error) {
            console.warn('⚠️ Failed to fetch ouvrage/lot info:', error.message);
        }

        return this.createEventAndNotify({
            action: resolvedGblocId ? 'bloc_deleted_ouvrage' : 'bloc_deleted',
            metadata: {
                bloc_name: blocName,
                gbloc_name: gblocName,
                lot_name: lotName
            },
            lot: lotName,
            userId,
            projectId,
            blocId: null,
            gblocId: resolvedGblocId,
            gblocNom: gblocName,
            blocNom: blocName,
            notifyAdmins: false,
            notifyProjectUsers: true
        });
    }

    // ==================== ARTICLE EVENTS ====================

    static async articleAdded(projectId, articleId, userId, articleData) {
        console.log('🔍 articleAdded called with:', { projectId, articleId, userId, articleData });

        let articleName = articleData.nom_article || articleData.article_name ||
            articleData.Niveau_7__detail_article || articleData.niveau_7;

        if (articleId) {
            try {
                const artRes = await pool.query(
                    'SELECT nom_article FROM articles WHERE "ID" = $1',
                    [articleId]
                );
                if (artRes.rows[0]?.nom_article) {
                    articleName = artRes.rows[0].nom_article;
                }
            } catch (e) {
                console.warn('⚠️ Failed to fetch article name:', e.message);
            }
        }


        // articleData.lot already contains the lot NAME (not ID) from calling code
        let lotName = articleData.lot || null;
        let lotId = articleData.lotId || null; // Use lotId if provided directly

        // Fallback: If lot ID is missing but we have gblocId, try to resolve it from ouvrage
        const gblocId = articleData.g_bloc || articleData.ouvrage || null;
        if (!lotId && gblocId) {
            try {
                const lotRes = await pool.query(`
                    SELECT pl.id_lot as lot_id, n2.niveau_2 as lot_name
                    FROM ouvrage o
                    INNER JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                    LEFT JOIN niveau_2 n2 ON n2.id_niveau_2 = pl.id_lot
                    WHERE o.id = $1
                `, [gblocId]);

                console.log('🔍 Lot resolution query result:', lotRes.rows[0]);

                if (lotRes.rows[0]) {
                    lotId = lotRes.rows[0].lot_id;
                    if (!lotName) {
                        lotName = lotRes.rows[0].lot_name;
                    }
                }
            } catch (e) {
                console.warn('⚠️ Failed to resolve lot for article added event:', e.message);
            }
        }

        console.log('🔍 articleAdded - Resolved lot info:', { lotId, lotName, gblocId });

        return this.createEventAndNotify({
            action: 'article_added',
            metadata: {
                article_name: articleName,
                nom_article: articleName,
                Niveau_7__detail_article: articleName,
                bloc_nom: articleData.nom_bloc,
                gbloc_name: articleData.nom_ouvrage || articleData.nom_gbloc,
                quantite: articleData.quantite,
                prix_total: articleData.total_ttc,
                localisation: articleData.localisation,
                lot_name: lotName  // Add lot name to metadata for display
            },
            lot: lotId,  // Pass lot ID (number) for database storage
            userId,
            projectId,
            articleId,
            blocId: articleData.bloc,
            gblocId: articleData.g_bloc || articleData.ouvrage || null,
            notifyAdmins: false,
            notifyProjectUsers: true
        });
    }

    static async articleUpdated(projectId, articleId, userId, changes, blocId = null, gblocId = null, lotName = null) {
        const meta = {};
        try {
            const raw = changes && typeof changes === 'object' ? changes : {};
            const sanitized = {};
            const considerKeys = new Set(['pu', 'nouv_prix', 'quantite', 'tva', 'localisation', 'description']);

            for (const [k, v] of Object.entries(raw)) {
                if (!considerKeys.has(k)) continue;
                if (v && typeof v === 'object' && ('to' in v)) {
                    const from = v.from;
                    const to = v.to;
                    if (from !== undefined && String(from) === String(to)) continue;

                    if (k === 'nouv_prix') {
                        if (!sanitized.pu) {
                            sanitized.pu = { from, to };
                        }
                    } else {
                        sanitized[k] = { from, to };
                    }
                }
            }
            meta.changes = sanitized;
        } catch (e) {
            meta.changes = changes || {};
        }


        let resolvedLotName = null; // Declare before try block for scope
        let finalBlocId = blocId || null;
        let finalGblocId = gblocId || null;

        try {
            if (articleId) {
                const artRes = await pool.query(
                    'SELECT "nom_article" FROM articles WHERE "ID" = $1',
                    [articleId]
                );
                if (artRes.rows[0]?.nom_article) {
                    const artName = artRes.rows[0].nom_article;
                    meta.article_name = artName;
                    meta.nom_article = artName;
                    meta.Niveau_7__detail_article = artName;
                }
            }

            if (blocId) {
                const blocRes = await pool.query(
                    'SELECT nom_bloc FROM bloc WHERE id = $1',
                    [blocId]
                );
                if (blocRes.rows[0]?.nom_bloc) {
                    meta.nom_bloc = blocRes.rows[0].nom_bloc;
                }
            }

            if (gblocId) {
                const ouvrageRes = await pool.query(
                    'SELECT nom_ouvrage FROM ouvrage WHERE id = $1',
                    [gblocId]
                );
                if (ouvrageRes.rows[0]?.nom_ouvrage) {
                    meta.gbloc_name = ouvrageRes.rows[0].nom_ouvrage;
                }
            }


            // Get bloc, ouvrage, and lot from the projet_article's structure
            const paRes = await pool.query(
                `SELECT s.bloc as bloc_id, s.ouvrage as ouvrage_id, pl.id_lot as lot_id
                 FROM projet_article pa 
                 LEFT JOIN structure s ON s.id_structure = pa.structure 
                 LEFT JOIN ouvrage o ON o.id = s.ouvrage 
                 LEFT JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot
                 WHERE pa.article = $1 
                 ORDER BY pa.id DESC LIMIT 1`,
                [articleId]
            );
            const pa = paRes.rows[0] || {};

            // Use the bloc and ouvrage from structure if not already provided
            finalBlocId = blocId || pa.bloc_id || null;
            finalGblocId = gblocId || pa.ouvrage_id || null;
            const finalLotId = pa.lot_id || null;

            // Resolve bloc name if not already set
            if (!meta.nom_bloc && finalBlocId) {
                const blocRes = await pool.query('SELECT nom_bloc FROM bloc WHERE id = $1', [finalBlocId]);
                if (blocRes.rows[0]?.nom_bloc) {
                    meta.nom_bloc = blocRes.rows[0].nom_bloc;
                }
            }

            // Resolve ouvrage name if not already set
            if (!meta.gbloc_name && finalGblocId) {
                const ouvrageRes = await pool.query('SELECT nom_ouvrage FROM ouvrage WHERE id = $1', [finalGblocId]);
                if (ouvrageRes.rows[0]?.nom_ouvrage) {
                    meta.gbloc_name = ouvrageRes.rows[0].nom_ouvrage;
                }
            }

            // Resolve lot name
            const lotIdToUse = finalLotId || lotName;
            if (lotIdToUse) {
                const lotRes = await pool.query(
                    'SELECT niveau_2 as lot_name FROM niveau_2 WHERE id_niveau_2 = $1',
                    [lotIdToUse]
                );
                if (lotRes.rows[0]) {
                    resolvedLotName = lotRes.rows[0].lot_name;
                }
            }

            let puVal = null;
            if (pa.nouv_prix != null && Number(pa.nouv_prix) > 0) {
                puVal = Number(pa.nouv_prix);
            } else if (pa.prix_total_ht != null && pa.quantite != null && Number(pa.quantite) > 0) {
                puVal = Number(pa.prix_total_ht) / Number(pa.quantite);
            }

            if (puVal != null && isFinite(puVal) && !meta.changes?.pu) {
                meta.pu = puVal;
            }
            if (pa.quantite != null) meta.quantite = pa.quantite;
            if (pa.tva != null) meta.tva = pa.tva;
            if (pa.localisation != null && String(pa.localisation).trim() !== '') {
                meta.localisation = pa.localisation;
            }
            if (pa.description != null && String(pa.description).trim() !== '') {
                meta.description = pa.description;
            }
        } catch (e) {
            console.error('❌ Error during articleUpdated enrichment:', e.message);
        }

        return this.createEventAndNotify({
            action: 'article_updated',
            metadata: meta,
            lot: resolvedLotName,
            userId,
            projectId,
            articleId,
            blocId: finalBlocId,
            gblocId: finalGblocId,
            notifyAdmins: false,
            notifyProjectUsers: true
        });
    }

    static async articleDeleted(projectId, articleId, userId, articleName, blocId = null, gblocId = null, lotName = null) {
        console.log('🔍 articleDeleted:', { projectId, articleId, articleName, blocId, gblocId, lotName });

        const meta = { article_name: articleName };
        let resolvedLotName = lotName;

        try {
            if (blocId) {
                const blocRes = await pool.query(
                    'SELECT nom_bloc FROM bloc WHERE id = $1',
                    [blocId]
                );
                if (blocRes.rows[0]?.nom_bloc) {
                    meta.nom_bloc = blocRes.rows[0].nom_bloc;
                }
            }

            if (gblocId) {
                const ouvrageRes = await pool.query(
                    'SELECT nom_ouvrage FROM ouvrage WHERE id = $1',
                    [gblocId]
                );
                if (ouvrageRes.rows[0]?.nom_ouvrage) {
                    meta.gbloc_name = ouvrageRes.rows[0].nom_ouvrage;
                }
            }

            if (!resolvedLotName) {
                const paRes = await pool.query(
                    `SELECT pl.id_lot as lot 
                     FROM projet_article pa 
                     LEFT JOIN structure s ON s.id_structure = pa.structure 
                     LEFT JOIN ouvrage o ON o.id = s.ouvrage 
                     LEFT JOIN projet_lot pl ON pl.id_projet_lot = o.projet_lot 
                     WHERE pl.id_projet = $1 AND pa.article = $2 
                     ORDER BY pa.id DESC LIMIT 1`,
                    [projectId, articleId]
                );
                resolvedLotName = paRes.rows[0]?.lot || null;
            }

            resolvedLotName = await this.resolveLotName(resolvedLotName);
        } catch (e) {
            console.error('❌ Error during articleDeleted enrichment:', e.message);
        }

        return this.createEventAndNotify({
            action: 'article_deleted',
            metadata: meta,
            lot: resolvedLotName,
            userId,
            projectId,
            articleId,
            blocId,
            gblocId,
            notifyAdmins: false,
            notifyProjectUsers: true
        });
    }

    // ==================== LOT EVENTS ====================

    static async lotCreated(projectId, userId, lotData) {
        const lotName = await this.resolveLotName(lotData.name);

        return this.createEventAndNotify({
            action: 'lot_created',
            metadata: { lot_name: lotName },
            lot: lotName,
            userId,
            projectId,
            gblocId: lotData.gblocId,
            notifyAdmins: false,
            notifyProjectUsers: true
        });
    }

    static async lotUpdated(projectId, userId, lotName, changes) {
        const resolvedLotName = await this.resolveLotName(lotName);

        return this.createEventAndNotify({
            action: 'lot_updated',
            metadata: { changes },
            lot: resolvedLotName,
            userId,
            projectId,
            notifyAdmins: false,
            notifyProjectUsers: true
        });
    }

    static async lotDeleted(projectId, userId, lotName, gblocId = null, gblocName = null) {
        const resolvedLotName = await this.resolveLotName(lotName);

        return this.createEventAndNotify({
            action: 'lot_deleted',
            metadata: { lot_name: resolvedLotName },
            lot: resolvedLotName,
            userId,
            projectId,
            gblocId,
            gblocNom: gblocName,
            notifyAdmins: false,
            notifyProjectUsers: true
        });
    }

    // ==================== MAINTENANCE / CLEANUP ====================

    static async cleanupOldData(minutes = 60 * 24 * 60) {
        try {
            const deletedNotifications = await Notification.deleteOlderThan(minutes);
            const deletedEvents = await Event.deleteOlderThan(minutes);
            const days = minutes / (60 * 24);
            console.log(`🧹 Cleanup complete: deleted ${deletedEvents} events and ${deletedNotifications} notifications older than ${days} days`);
            return { deletedEvents, deletedNotifications };
        } catch (error) {
            console.error('❌ Error during cleanup:', error);
            throw error;
        }
    }
}

module.exports = EventNotificationService;
