const Fournisseur = require('../models/Fournisseur');
const Article = require('../models/Article');

/**
 * Get all fournisseurs
 */
exports.getAllFournisseurs = async (req, res) => {
    try {
        const { page = 1, limit = 100, search = '', type = '' } = req.query;
        
        const fournisseurs = await Fournisseur.findAll({
            search,
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            type
        });

        const total = await Fournisseur.count({ search, type });
        const totalPages = Math.ceil(total / parseInt(limit, 10));

        res.json({
            success: true,
            data: fournisseurs,
            pagination: {
                page: parseInt(page, 10),
                limit: parseInt(limit, 10),
                total,
                totalPages
            }
        });
    } catch (error) {
        console.error('Error fetching fournisseurs:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * Get fournisseur by ID
 */
exports.getFournisseurById = async (req, res) => {
    try {
        const fournisseurId = parseInt(req.params.id, 10);

        if (isNaN(fournisseurId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid fournisseur ID'
            });
        }

        const fournisseur = await Fournisseur.findById(fournisseurId);

        if (!fournisseur) {
            return res.status(404).json({
                success: false,
                message: 'Fournisseur not found'
            });
        }

        res.json({
            success: true,
            data: fournisseur
        });
    } catch (error) {
        console.error('Error fetching fournisseur:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * Create a new fournisseur
 */
exports.createFournisseur = async (req, res) => {
    try {
        const body = req.body || {};
        const fournisseurData = {
            ...body,
            url: body.url ?? body.URL ?? null,
        };

        // Validate required fields
        if (!fournisseurData.nom_fournisseur || fournisseurData.nom_fournisseur.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Le nom du fournisseur est requis'
            });
        }

        if (!fournisseurData.type || fournisseurData.type.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Le type du fournisseur est requis'
            });
        }

        if (!fournisseurData.categorie || fournisseurData.categorie.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'La catégorie du fournisseur est requise'
            });
        }

        // Validate email format if provided
        if (fournisseurData.email && fournisseurData.email.trim() !== '') {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(fournisseurData.email)) {
                return res.status(400).json({
                    success: false,
                    message: 'Format d\'email invalide'
                });
            }
        }

        // Check if fournisseur name already exists
        const existingFournisseur = await Fournisseur.findByName(fournisseurData.nom_fournisseur);
        if (existingFournisseur) {
            return res.status(400).json({
                success: false,
                message: 'Un fournisseur avec ce nom existe déjà'
            });
        }

        const fournisseur = await Fournisseur.create(fournisseurData);

        res.status(201).json({
            success: true,
            data: fournisseur,
            message: 'Fournisseur créé avec succès'
        });
    } catch (error) {
        console.error('Error creating fournisseur:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * Update fournisseur
 */
exports.updateFournisseur = async (req, res) => {
    try {
        const fournisseurId = parseInt(req.params.id, 10);

        if (isNaN(fournisseurId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid fournisseur ID'
            });
        }

        const raw = req.body || {};
        const fournisseurData = {
            ...raw,
            url: raw.url ?? raw.URL ?? null,
        };

        // Validate required fields if provided
        if (fournisseurData.nom_fournisseur !== undefined && fournisseurData.nom_fournisseur.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Le nom du fournisseur ne peut pas être vide'
            });
        }

        if (fournisseurData.type !== undefined && fournisseurData.type.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Le type du fournisseur ne peut pas être vide'
            });
        }

        if (fournisseurData.categorie !== undefined && fournisseurData.categorie.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'La catégorie du fournisseur ne peut pas être vide'
            });
        }

        // Validate email format if provided
        if (fournisseurData.email && fournisseurData.email.trim() !== '') {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(fournisseurData.email)) {
                return res.status(400).json({
                    success: false,
                    message: 'Format d\'email invalide'
                });
            }
        }

        // Check if fournisseur name already exists (excluding current fournisseur)
        if (fournisseurData.nom_fournisseur && fournisseurData.nom_fournisseur.trim() !== '') {
            const existingFournisseur = await Fournisseur.findByName(fournisseurData.nom_fournisseur, fournisseurId);
            if (existingFournisseur) {
                return res.status(400).json({
                    success: false,
                    message: 'Un fournisseur avec ce nom existe déjà'
                });
            }
        }

        const updatedFournisseur = await Fournisseur.update(fournisseurId, fournisseurData);

        if (!updatedFournisseur) {
            return res.status(404).json({
                success: false,
                message: 'Fournisseur not found'
            });
        }

        res.json({
            success: true,
            data: updatedFournisseur,
            message: 'Fournisseur mis à jour avec succès'
        });
    } catch (error) {
        console.error('Error updating fournisseur:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * Delete fournisseur
 */
exports.deleteFournisseur = async (req, res) => {
    try {
        const fournisseurId = parseInt(req.params.id, 10);

        if (isNaN(fournisseurId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid fournisseur ID'
            });
        }

        // Check if fournisseur exists
        const existingFournisseur = await Fournisseur.findById(fournisseurId);
        if (!existingFournisseur) {
            return res.status(404).json({
                success: false,
                message: 'Fournisseur not found'
            });
        }

        await Fournisseur.delete(fournisseurId);

        res.json({
            success: true,
            message: 'Fournisseur supprimé avec succès'
        });
    } catch (error) {
        console.error('Error deleting fournisseur:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * Get lots (niveau 2) from articles for dropdown
 */
exports.getLots = async (req, res) => {
    try {
        const { search = '' } = req.query;
        
        console.log('Fetching lots with search:', search);
        
        const lots = await Article.searchDistinct('Niveau_2__lot', search);
        
        console.log('Lots fetched:', lots);

        res.json({
            success: true,
            data: lots
        });
    } catch (error) {
        console.error('Error fetching lots:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * Get fournisseurs for dropdown (id, nom_fournisseur, type)
 */
exports.getFournisseursForDropdown = async (req, res) => {
    try {
        const fournisseurs = await Fournisseur.findAll({
            search: '',
            page: 1,
            limit: 1000 // Get all fournisseurs
        });

        // Return simplified data for dropdown
        const dropdownData = fournisseurs.map(f => ({
            id: f.id_fournisseur,
            nom_fournisseur: f.nom_fournisseur,
            type: f.type
        }));

        res.json({
            success: true,
            data: dropdownData
        });
    } catch (error) {
        console.error('Error fetching fournisseurs for dropdown:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};
