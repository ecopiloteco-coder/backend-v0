const Event = require('../models/Event');
const Notification = require('../models/Notification');
const Project = require('../models/Project');

/**
 * Create a new event and notify relevant users
 */
exports.createEvent = async (req, res) => {
    try {
        const { action, metadata, lot, projectId, articleId, blocId, gblocId } = req.body;
        const userId = req.user?.id;

        if (!action || !projectId) {
            return res.status(400).json({ error: 'Action and projectId are required' });
        }

        // 1) Insert event first (critical path)
        const event = await Event.createWithNames({
            action,
            metadata,
            lot,
            userId,
            projectId,
            articleId,
            blocId,
            gblocId
        });

        // Recalculate project's selling price (prix_vente) after event creation
        if (projectId) {
            try {
                await Project.recalculatePrixVente(projectId);
                console.log(`✅ Recalculated prix_vente after event creation: ${action}`);
            } catch (recalcError) {
                console.error(`❌ Failed to recalculate prix_vente after event creation (${action}):`, recalcError);
                // Don't fail the event creation if recalculation fails
            }
        }

        // 2) Respond immediately to reduce user perceived latency
        res.status(201).json({ success: true, event });

        // 3) Continue work asynchronously (non-blocking): notifications + SSE
        // Use nextTick to avoid holding the event loop for the response
        process.nextTick(async () => {
            try {
                // Fetch team and project in parallel
                const [teamMembers, project] = await Promise.all([
                    Project.getTeamMembers(projectId),
                    Project.findById(projectId),
                ]);

                // Collect all user IDs to notify (team + creator, excluding the actor)
                const userIdsToNotify = new Set();
                if (project?.Ajouté_par && project.Ajouté_par !== userId) {
                    userIdsToNotify.add(project.Ajouté_par);
                }
                for (const member of (teamMembers || [])) {
                    if (member.id !== userId) userIdsToNotify.add(member.id);
                }

                if (userIdsToNotify.size > 0) {
                    // Bulk create notifications (implementation should batch on the model side)
                    await Notification.createForUsers(event.id_event, Array.from(userIdsToNotify));
                }

                // SSE broadcast (best-effort, do not throw)
                const subscribers = global.projectSubscribers?.get(projectId.toString());
                if (subscribers && subscribers.size > 0) {
                    // Prefer req.user data to avoid extra DB query
                    const userName = req.user?.nom_utilisateur || null;
                    const userEmail = req.user?.email || null;
                    const eventData = {
                        id_event: event.id_event,
                        action: event.action,
                        created_at: event.created_at,
                        metadata: event.metadata,
                        lot: event.lot,
                        lot_name: event.metadata?.lot_name || null,
                        user_id: event.user,
                        user_name: userName,
                        user_email: userEmail,
                        project_id: event.projet,
                        article_id: event.article,
                        bloc_id: event.bloc,
                        gbloc_id: event.ouvrage || event.gbloc,
                        bloc_nom: event.bloc_nom_anc || event.bloc_nom,
                        gbloc_nom: event.ouvrage_nom_anc || event.gbloc_nom
                    };

                    console.log('📡 Broadcasting event via SSE to', subscribers.size, 'subscribers:', eventData.action);
                    subscribers.forEach(clientRes => {
                        try {
                            clientRes.write(`event: notification\n`);
                            clientRes.write(`data: ${JSON.stringify(eventData)}\n\n`);
                        } catch (err) {
                            console.error('SSE send error:', err);
                        }
                    });
                }
            } catch (bgErr) {
                console.error('Background event processing error:', bgErr);
            }
        });
    } catch (error) {
        console.error('Error creating event:', error);
        // Only send error if we failed before sending the 201 response
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to create event' });
        }
    }
};

/**
 * Get events for a project
 */
exports.getProjectEvents = async (req, res) => {
    try {
        const { projectId } = req.params;
        const { limit = 50, offset = 0 } = req.query;
        const userId = req.user?.id;
        const isAdmin = req.user?.is_admin || req.user?.role === 'admin';

        // Check access
        const hasAccess = await Project.checkUserAccess(projectId, userId, isAdmin);
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const events = await Event.findByProject(projectId, {
            limit: parseInt(limit, 10),
            offset: parseInt(offset, 10)
        });

        res.json({ events: events || [] });
    } catch (error) {
        console.error('Error fetching project events:', error);
        res.status(500).json({ error: 'Failed to fetch events' });
    }
};

/**
 * Get recent events for a project
 */
exports.getRecentProjectEvents = async (req, res) => {
    try {
        const { projectId } = req.params;
        const { minutes, hours } = req.query;
        const userId = req.user?.id;
        const isAdmin = req.user?.is_admin || req.user?.role === 'admin';

        console.log('getRecentProjectEvents called for project:', projectId, 'user:', userId);

        // Check access
        const hasAccess = await Project.checkUserAccess(projectId, userId, isAdmin);
        if (!hasAccess) {
            console.log('Access denied for user', userId, 'to project', projectId);
            return res.status(403).json({ error: 'Access denied' });
        }

        try {
            // Default window: last 5 minutes
            let windowMinutes = 5;
            if (typeof minutes === 'string') {
                const parsed = parseInt(minutes, 10);
                if (!Number.isNaN(parsed) && parsed > 0) {
                    windowMinutes = parsed;
                }
            } else if (typeof hours === 'string') {
                const parsedH = parseInt(hours, 10);
                if (!Number.isNaN(parsedH) && parsedH > 0) {
                    windowMinutes = parsedH * 60;
                }
            }

            const events = await Event.findRecentByProject(projectId, windowMinutes);
            console.log('Found events for project', projectId, ':', events?.length || 0);
            if (events && events.length > 0) {
                console.log('Sample event:', JSON.stringify(events[0], null, 2));
            }
            res.json({ events: events || [] });
        } catch (dbError) {
            console.log('Database error fetching events (likely permissions):', dbError.message);
            // Return empty array instead of failing
            res.json({ events: [] });
        }
    } catch (error) {
        console.error('Error fetching recent events:', error);
        res.status(500).json({ error: 'Failed to fetch recent events' });
    }
};
