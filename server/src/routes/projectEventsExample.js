const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const Article = require('../models/Article');
const Bloc = require('../models/Bloc');
const Gbloc = require('../models/Gbloc');
const Lot = require('../models/Lot');
const EventNotificationService = require('../services/EventNotificationService');

// Middleware to extract user info (you should adapt this to your auth system)
const getUserInfo = (req) => {
    // This should extract user ID and role from your authentication system
    return {
        userId: req.user?.id || req.body.userId || req.headers['x-user-id'],
        isAdmin: req.user?.role === 'admin' || req.headers['x-user-role'] === 'admin'
    };
};

// ==================== PROJECT ROUTES ====================

/**
 * Create project with event notification
 */
router.post('/projects', async (req, res) => {
    try {
        const { userId } = getUserInfo(req);
        if (!userId) {
            return res.status(401).json({ error: 'User authentication required' });
        }

        const projectData = { ...req.body, userId };
        const projectId = await Project.create(projectData);
        
        res.status(201).json({ 
            success: true, 
            projectId,
            message: 'Project created successfully with notifications sent'
        });
    } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Update project with event notification
 */
router.put('/projects/:id', async (req, res) => {
    try {
        const { userId, isAdmin } = getUserInfo(req);
        if (!userId) {
            return res.status(401).json({ error: 'User authentication required' });
        }

        const projectId = req.params.id;
        const isUserAction = !isAdmin; // If not admin, it's a user action
        
        const success = await Project.update(projectId, req.body, userId, isUserAction);
        
        if (success) {
            res.json({ 
                success: true, 
                message: 'Project updated successfully with notifications sent'
            });
        } else {
            res.status(404).json({ error: 'Project not found' });
        }
    } catch (error) {
        console.error('Error updating project:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Delete project with event notification
 */
router.delete('/projects/:id', async (req, res) => {
    try {
        const { userId } = getUserInfo(req);
        if (!userId) {
            return res.status(401).json({ error: 'User authentication required' });
        }

        const projectId = req.params.id;
        const success = await Project.delete(projectId, userId);
        
        if (success) {
            res.json({ 
                success: true, 
                message: 'Project deleted successfully with notifications sent'
            });
        } else {
            res.status(404).json({ error: 'Project not found' });
        }
    } catch (error) {
        console.error('Error deleting project:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Update project team with event notification
 */
router.put('/projects/:id/team', async (req, res) => {
    try {
        const { userId } = getUserInfo(req);
        if (!userId) {
            return res.status(401).json({ error: 'User authentication required' });
        }

        const projectId = req.params.id;
        const { userIds } = req.body;
        
        const success = await Project.updateTeam(projectId, userIds, userId);
        
        if (success) {
            res.json({ 
                success: true, 
                message: 'Team updated successfully with notifications sent'
            });
        } else {
            res.status(500).json({ error: 'Failed to update team' });
        }
    } catch (error) {
        console.error('Error updating team:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== GBLOC ROUTES ====================

/**
 * Create grand bloc with event notification
 */
router.post('/projects/:id/gblocs', async (req, res) => {
    try {
        const { userId, isAdmin } = getUserInfo(req);
        if (!userId) {
            return res.status(401).json({ error: 'User authentication required' });
        }

        const projectId = req.params.id;
        const gbloc = await Project.createGbloc(projectId, req.body, userId, isAdmin);
        
        res.status(201).json({ 
            success: true, 
            gbloc,
            message: 'Grand bloc created successfully with notifications sent'
        });
    } catch (error) {
        console.error('Error creating gbloc:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Update grand bloc with event notification
 */
router.put('/gblocs/:id', async (req, res) => {
    try {
        const { userId } = getUserInfo(req);
        if (!userId) {
            return res.status(401).json({ error: 'User authentication required' });
        }

        const gblocId = req.params.id;
        const { projectId } = req.body; // Should be provided in request
        
        const gbloc = await Gbloc.update(gblocId, req.body, userId, projectId);
        
        res.json({ 
            success: true, 
            gbloc,
            message: 'Grand bloc updated successfully with notifications sent'
        });
    } catch (error) {
        console.error('Error updating gbloc:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Delete grand bloc with event notification
 */
router.delete('/gblocs/:id', async (req, res) => {
    try {
        const { userId } = getUserInfo(req);
        if (!userId) {
            return res.status(401).json({ error: 'User authentication required' });
        }

        const gblocId = req.params.id;
        const { projectId } = req.body; // Should be provided in request
        
        const success = await Gbloc.delete(gblocId, userId, projectId);
        
        if (success) {
            res.json({ 
                success: true, 
                message: 'Grand bloc deleted successfully with notifications sent'
            });
        } else {
            res.status(404).json({ error: 'Grand bloc not found' });
        }
    } catch (error) {
        console.error('Error deleting gbloc:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== BLOC ROUTES ====================

/**
 * Create bloc with event notification
 */
router.post('/projects/:id/blocs', async (req, res) => {
    try {
        const { userId, isAdmin } = getUserInfo(req);
        if (!userId) {
            return res.status(401).json({ error: 'User authentication required' });
        }

        const projectId = req.params.id;
        const bloc = await Bloc.create(projectId, req.body, userId, isAdmin);
        
        res.status(201).json({ 
            success: true, 
            bloc,
            message: 'Bloc created successfully with notifications sent'
        });
    } catch (error) {
        console.error('Error creating bloc:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Update bloc with event notification
 */
router.put('/blocs/:id', async (req, res) => {
    try {
        const { userId } = getUserInfo(req);
        if (!userId) {
            return res.status(401).json({ error: 'User authentication required' });
        }

        const blocId = req.params.id;
        const { projectId } = req.body; // Should be provided in request
        
        const bloc = await Bloc.update(blocId, req.body, userId, projectId);
        
        res.json({ 
            success: true, 
            bloc,
            message: 'Bloc updated successfully with notifications sent'
        });
    } catch (error) {
        console.error('Error updating bloc:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Delete bloc with event notification
 */
router.delete('/blocs/:id', async (req, res) => {
    try {
        const { userId } = getUserInfo(req);
        if (!userId) {
            return res.status(401).json({ error: 'User authentication required' });
        }

        const blocId = req.params.id;
        const { projectId } = req.body; // Should be provided in request
        
        const success = await Bloc.delete(blocId, userId, projectId);
        
        if (success) {
            res.json({ 
                success: true, 
                message: 'Bloc deleted successfully with notifications sent'
            });
        } else {
            res.status(404).json({ error: 'Bloc not found' });
        }
    } catch (error) {
        console.error('Error deleting bloc:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ARTICLE ROUTES ====================

/**
 * Add article to bloc with event notification
 */
router.post('/projects/:projectId/blocs/:blocId/articles', async (req, res) => {
    try {
        const { userId, isAdmin } = getUserInfo(req);
        if (!userId) {
            return res.status(401).json({ error: 'User authentication required' });
        }

        const { projectId, blocId } = req.params;
        const article = await Project.addArticleToBloc(projectId, blocId, req.body, userId, isAdmin);
        
        res.status(201).json({ 
            success: true, 
            article,
            message: 'Article added successfully with notifications sent'
        });
    } catch (error) {
        console.error('Error adding article:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Update article in project with event notification
 */
router.put('/projects/:projectId/articles/:articleId', async (req, res) => {
    try {
        const { userId } = getUserInfo(req);
        if (!userId) {
            return res.status(401).json({ error: 'User authentication required' });
        }

        const { projectId, articleId } = req.params;
        const article = await Article.updateInProject(projectId, articleId, req.body, userId);
        
        res.json({ 
            success: true, 
            article,
            message: 'Article updated successfully with notifications sent'
        });
    } catch (error) {
        console.error('Error updating article:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Remove article from project with event notification
 */
router.delete('/projects/:projectId/articles/:articleId', async (req, res) => {
    try {
        const { userId } = getUserInfo(req);
        if (!userId) {
            return res.status(401).json({ error: 'User authentication required' });
        }

        const { projectId, articleId } = req.params;
        const success = await Article.removeFromProject(projectId, articleId, userId);
        
        if (success) {
            res.json({ 
                success: true, 
                message: 'Article removed successfully with notifications sent'
            });
        } else {
            res.status(404).json({ error: 'Article not found in project' });
        }
    } catch (error) {
        console.error('Error removing article:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== LOT ROUTES ====================

/**
 * Create lot with event notification
 */
router.post('/projects/:id/lots', async (req, res) => {
    try {
        const { userId } = getUserInfo(req);
        if (!userId) {
            return res.status(401).json({ error: 'User authentication required' });
        }

        const projectId = req.params.id;
        const lot = await Lot.create(projectId, req.body, userId);
        
        res.status(201).json({ 
            success: true, 
            lot,
            message: 'Lot created successfully with notifications sent'
        });
    } catch (error) {
        console.error('Error creating lot:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Update lot with event notification
 */
router.put('/projects/:projectId/lots/:lotName', async (req, res) => {
    try {
        const { userId } = getUserInfo(req);
        if (!userId) {
            return res.status(401).json({ error: 'User authentication required' });
        }

        const { projectId, lotName } = req.params;
        const { newName } = req.body;
        
        const success = await Lot.update(projectId, lotName, newName, userId);
        
        if (success) {
            res.json({ 
                success: true, 
                message: 'Lot updated successfully with notifications sent'
            });
        } else {
            res.status(404).json({ error: 'Lot not found' });
        }
    } catch (error) {
        console.error('Error updating lot:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Delete lot with event notification
 */
router.delete('/projects/:projectId/lots/:lotName', async (req, res) => {
    try {
        const { userId } = getUserInfo(req);
        if (!userId) {
            return res.status(401).json({ error: 'User authentication required' });
        }

        const { projectId, lotName } = req.params;
        const success = await Lot.delete(projectId, lotName, userId);
        
        if (success) {
            res.json({ 
                success: true, 
                message: 'Lot deleted successfully with notifications sent'
            });
        } else {
            res.status(404).json({ error: 'Lot not found' });
        }
    } catch (error) {
        console.error('Error deleting lot:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
