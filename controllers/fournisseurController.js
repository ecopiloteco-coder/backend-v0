const { Fournisseur, Article } = require('../models');

/**
 * Get all fournisseurs with pagination
 * GET /api/fournisseurs?page=1&limit=30
 */
exports.getAllFournisseurs = async (req, res) => {
    try {
        // Get pagination parameters from query string
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 30;
        const offset = (page - 1) * limit;

        // Get total count
        const total = await Fournisseur.count();

        // Get paginated fournisseurs
        const fournisseurs = await Fournisseur.findAll({
            include: [
                {
                    model: Article,
                    as: 'articles',
                    attributes: ['ID']
                }
            ],
            order: [['nom_fournisseur', 'ASC']],
            limit: limit,
            offset: offset
        });

        // Map to include articlesCount
        const data = fournisseurs.map(f => {
            const fournisseur = f.toJSON();
            fournisseur.articlesCount = fournisseur.articles ? fournisseur.articles.length : 0;
            delete fournisseur.articles;
            return fournisseur;
        });

        res.status(200).json({
            success: true,
            data: data,
            pagination: {
                total: total,
                page: page,
                limit: limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching fournisseurs:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching fournisseurs',
            error: error.message
        });
    }
};

/**
 * Get fournisseur by ID
 * GET /api/fournisseurs/:id
 */
exports.getFournisseurById = async (req, res) => {
    try {
        const { id } = req.params;
        const fournisseur = await Fournisseur.findByPk(id, {
            include: [
                {
                    model: Article,
                    as: 'articles',
                    attributes: ['ID']
                }
            ]
        });

        if (!fournisseur) {
            return res.status(404).json({
                success: false,
                message: 'Fournisseur not found'
            });
        }

        const data = fournisseur.toJSON();
        data.articlesCount = data.articles ? data.articles.length : 0;
        delete data.articles;

        res.status(200).json({
            success: true,
            data: data
        });
    } catch (error) {
        console.error('Error fetching fournisseur:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching fournisseur',
            error: error.message
        });
    }
};

/**
 * Create new fournisseur
 * POST /api/fournisseurs
 */
exports.createFournisseur = async (req, res) => {
    try {
        const {
            nom_fournisseur,
            type,
            categorie,
            adresse,
            telephone,
            email,
            URL
        } = req.body;

        if (!nom_fournisseur) {
            return res.status(400).json({
                success: false,
                message: 'nom_fournisseur is required'
            });
        }

        const fournisseur = await Fournisseur.create({
            nom_fournisseur,
            type,
            categorie,
            adresse,
            telephone,
            email,
            URL
        });

        res.status(201).json({
            success: true,
            message: 'Fournisseur created successfully',
            data: fournisseur
        });
    } catch (error) {
        console.error('Error creating fournisseur:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating fournisseur',
            error: error.message
        });
    }
};

/**
 * Update fournisseur
 * PUT /api/fournisseurs/:id
 */
exports.updateFournisseur = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const fournisseur = await Fournisseur.findByPk(id);

        if (!fournisseur) {
            return res.status(404).json({
                success: false,
                message: 'Fournisseur not found'
            });
        }

        await fournisseur.update(updateData);

        res.status(200).json({
            success: true,
            message: 'Fournisseur updated successfully',
            data: fournisseur
        });
    } catch (error) {
        console.error('Error updating fournisseur:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating fournisseur',
            error: error.message
        });
    }
};

/**
 * Delete fournisseur
 * DELETE /api/fournisseurs/:id
 */
exports.deleteFournisseur = async (req, res) => {
    try {
        const { id } = req.params;
        const fournisseur = await Fournisseur.findByPk(id);

        if (!fournisseur) {
            return res.status(404).json({
                success: false,
                message: 'Fournisseur not found'
            });
        }

        // Check if there are associated articles
        const articlesCount = await Article.count({ where: { fournisseur: id } });
        if (articlesCount > 0) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete fournisseur with ${articlesCount} associated articles. Please reassign or delete the articles first.`
            });
        }

        await fournisseur.destroy();

        res.status(200).json({
            success: true,
            message: 'Fournisseur deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting fournisseur:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting fournisseur',
            error: error.message
        });
    }
};

/**
 * Get unique fournisseur types
 * GET /api/fournisseurs/types
 */
exports.getFournisseurTypes = async (req, res) => {
    try {
        const { Sequelize } = require('sequelize');

        // Get distinct types from fournisseur table
        const types = await Fournisseur.findAll({
            attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('type')), 'type']],
            where: {
                type: {
                    [Sequelize.Op.ne]: null,
                    [Sequelize.Op.ne]: ''
                }
            },
            raw: true
        });

        // Extract type values and filter out any nulls/empty strings
        const typeList = types
            .map(t => t.type)
            .filter(type => type && type.trim() !== '')
            .sort();

        res.status(200).json({
            success: true,
            data: typeList
        });
    } catch (error) {
        console.error('Error fetching fournisseur types:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching fournisseur types',
            error: error.message
        });
    }
};

