const {
    Article,
    ArticleSupprime,
    PendingArticle,
    Niveau6,
    Niveau5,
    Niveau4,
    Niveau3,
    Niveau2,
    Niveau1,
    User,
    Fournisseur
} = require('../models');
const { Sequelize } = require('sequelize');

/**
 * Create a new article
 * POST /api/articles
 */
exports.createArticle = async (req, res) => {
    try {
        const {
            Date: articleDate,
            nom_article, // Niveau 7
            Unite,
            Type,
            Expertise,
            Fourniture,
            Cadence,
            Accessoires,
            Pertes,
            PU,
            Prix_Cible,
            Prix_estime,
            Prix_consulte,
            Rabais,
            Commentaires,
            User: userId,
            Indice_de_confiance,
            files,
            fournisseur,
            id_niv_6, // Original ID link
            Niveau_1,
            Niveau_2,
            Niveau_3,
            Niveau_4,
            Niveau_5,
            Niveau_6
        } = req.body;

        let article_id_niv_6 = id_niv_6;

        // If id_niv_6 is not provided, try to find or create levels from strings
        if (!article_id_niv_6 && Niveau_1 && Niveau_2 && Niveau_3 && Niveau_6) {
            // Find or create Niveau 1
            const [n1] = await Niveau1.findOrCreate({ where: { niveau_1: Niveau_1 } });

            // Find or create Niveau 2
            const [n2] = await Niveau2.findOrCreate({
                where: { niveau_2: Niveau_2, id_niv_1: n1.id_niveau_1 }
            });

            // Find or create Niveau 3
            const [n3] = await Niveau3.findOrCreate({
                where: { niveau_3: Niveau_3, id_niv_2: n2.id_niveau_2 }
            });

            // Find or create Niveau 4 (optional)
            let n4_id = null;
            if (Niveau_4) {
                const [n4] = await Niveau4.findOrCreate({
                    where: { niveau_4: Niveau_4, id_niv_3: n3.id_niveau_3 }
                });
                n4_id = n4.id_niveau_4;
            }

            // Find or create Niveau 5 (optional)
            let n5_id = null;
            if (Niveau_5) {
                const [n5] = await Niveau5.findOrCreate({
                    where: { niveau_5: Niveau_5, id_niv_4: n4_id, id_niv_3: n3.id_niveau_3 }
                });
                n5_id = n5.id_niveau_5;
            }

            // Find or create Niveau 6
            const [n6] = await Niveau6.findOrCreate({
                where: {
                    niveau_6: Niveau_6,
                    id_niv_5: n5_id,
                    id_niv_4: n4_id,
                    id_niv_3: n3.id_niveau_3
                }
            });

            article_id_niv_6 = n6.id_niveau_6;
        }

        // Validate required fields
        if (!nom_article) {
            return res.status(400).json({
                success: false,
                message: 'nom_article (Niveau 7) is required'
            });
        }

        if (!article_id_niv_6) {
            return res.status(400).json({
                success: false,
                message: 'id_niv_6 OR complete hierarchy strings (Niveau_1, 2, 3, 6) are required'
            });
        }

        // Verify that the niveau_6 exists
        const niveau6Exists = await Niveau6.findByPk(article_id_niv_6);
        if (!niveau6Exists) {
            return res.status(404).json({
                success: false,
                message: 'Niveau 6 not found'
            });
        }

        // Check if user is admin - fetch user data
        let isAdmin = false;
        if (userId) {
            const user = await User.findByPk(userId);
            isAdmin = user && user.is_admin;
        }

        // If user is NOT admin, create pending article instead
        if (!isAdmin) {
            const pendingArticle = await PendingArticle.create({
                Date: articleDate || new Date(),
                nom_article,
                Unite,
                Type,
                Expertise,
                Fourniture,
                Cadence,
                Accessoires,
                Pertes,
                PU,
                Prix_Cible,
                Prix_estime,
                Prix_consulte,
                Rabais,
                Commentaires,
                created_by: userId,
                status: 'En attente',
                submitted_at: new Date(),
                Indice_de_confiance: Indice_de_confiance || 3,
                files: typeof files === 'string' ? files : JSON.stringify(files || []),
                fournisseur,
                id_niv_6: article_id_niv_6
            });

            return res.status(201).json({
                success: true,
                message: 'Article soumis et en attente d\'approbation',
                isPending: true,
                data: pendingArticle
            });
        }

        // Admin users: Create article directly
        const article = await Article.create({
            Date: articleDate || new Date(),
            nom_article,
            Unite,
            Type,
            Expertise,
            Fourniture,
            Cadence,
            Accessoires,
            Pertes,
            PU,
            Prix_Cible,
            Prix_estime,
            Prix_consulte,
            Rabais,
            Commentaires,
            User: userId,
            Indice_de_confiance: Indice_de_confiance || 3,
            files: typeof files === 'string' ? files : JSON.stringify(files || []),
            fournisseur,
            id_niv_6: article_id_niv_6
        });

        // Fetch the created article with all associations
        const createdArticle = await Article.findByPk(article.ID, {
            include: [
                {
                    model: Niveau6,
                    as: 'niveau6',
                    include: [
                        {
                            model: Niveau5,
                            as: 'niveau5',
                            include: [
                                {
                                    model: Niveau4,
                                    as: 'niveau4',
                                    include: [
                                        {
                                            model: Niveau3,
                                            as: 'niveau3',
                                            include: [
                                                {
                                                    model: Niveau2,
                                                    as: 'niveau2',
                                                    include: [
                                                        {
                                                            model: Niveau1,
                                                            as: 'niveau1'
                                                        }
                                                    ]
                                                }
                                            ]
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'nom_utilisateur', 'email']
                },
                {
                    model: Fournisseur,
                    as: 'fournisseurData'
                }
            ]
        });

        res.status(201).json({
            success: true,
            message: 'Article created successfully',
            data: createdArticle
        });
    } catch (error) {
        console.error('Error creating article:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating article',
            error: error.message
        });
    }
};

/**
 * Get all articles
 * GET /api/articles
 */
exports.getAllArticles = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 30,
            search,
            expertise,
            niveau1,
            niveau2,
            date,
            sortBy = 'ID',
            sortOrder = 'DESC'
        } = req.query;
        const offset = (page - 1) * limit;

        const whereClause = {};
        if (search) {
            whereClause.nom_article = {
                [require('sequelize').Op.iLike]: `%${search}%`
            };
        }
        if (expertise && expertise !== 'all') {
            // Normalize both database value and filter value to handle accents
            // This will match "Confirmé" with "confirme", "Débutant" with "debutant", etc.
            whereClause[Sequelize.Op.and] = Sequelize.where(
                Sequelize.fn('LOWER', Sequelize.fn('REGEXP_REPLACE',
                    Sequelize.col('Expertise'),
                    '[éèêë]', 'e', 'gi'
                )),
                expertise.toLowerCase()
            );
        }
        if (date) {
            whereClause.Date = date;
        }

        const { count, rows: articles } = await Article.findAndCountAll({
            where: whereClause,
            limit: parseInt(limit),
            offset: parseInt(offset),
            distinct: true, // Important for counts with includes
            include: [
                {
                    model: Niveau6,
                    as: 'niveau6',
                    required: false,
                    include: [
                        {
                            model: Niveau5,
                            as: 'niveau5',
                            required: false,
                            include: [
                                {
                                    model: Niveau4,
                                    as: 'niveau4',
                                    required: false,
                                    include: [
                                        {
                                            model: Niveau3,
                                            as: 'niveau3',
                                            required: (niveau2 && niveau2 !== 'all') || (niveau1 && niveau1 !== 'all'),
                                            include: [
                                                {
                                                    model: Niveau2,
                                                    as: 'niveau2',
                                                    required: (niveau2 && niveau2 !== 'all') || (niveau1 && niveau1 !== 'all'),
                                                    where: niveau2 && niveau2 !== 'all' ? { niveau_2: niveau2 } : {},
                                                    include: [
                                                        {
                                                            model: Niveau1,
                                                            as: 'niveau1',
                                                            required: (niveau1 && niveau1 !== 'all'),
                                                            where: niveau1 && niveau1 !== 'all' ? { niveau_1: niveau1 } : {}
                                                        }
                                                    ]
                                                }
                                            ]
                                        }
                                    ]
                                },
                                {
                                    model: Niveau3,
                                    as: 'niveau3',
                                    required: false,
                                    include: [
                                        {
                                            model: Niveau2,
                                            as: 'niveau2',
                                            required: false,
                                            include: [
                                                {
                                                    model: Niveau1,
                                                    as: 'niveau1',
                                                    required: false
                                                }
                                            ]
                                        }
                                    ]
                                }
                            ]
                        },
                        {
                            model: Niveau4,
                            as: 'niveau4',
                            required: false,
                            include: [
                                {
                                    model: Niveau3,
                                    as: 'niveau3',
                                    required: false,
                                    include: [
                                        {
                                            model: Niveau2,
                                            as: 'niveau2',
                                            required: false,
                                            include: [
                                                {
                                                    model: Niveau1,
                                                    as: 'niveau1',
                                                    required: false
                                                }
                                            ]
                                        }
                                    ]
                                }
                            ]
                        },
                        {
                            model: Niveau3,
                            as: 'niveau3',
                            required: false,
                            include: [
                                {
                                    model: Niveau2,
                                    as: 'niveau2',
                                    required: false,
                                    include: [
                                        {
                                            model: Niveau1,
                                            as: 'niveau1',
                                            required: false
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'nom_utilisateur', 'email']
                },
                {
                    model: Fournisseur,
                    as: 'fournisseurData'
                }
            ],
            order: [[sortBy, sortOrder.toUpperCase()]]
        });

        // Transform nested Niveau data to flat structure for each article
        const transformedArticles = articles.map(article => {
            const articleData = article.toJSON();
            const n6 = articleData.niveau6;
            const n5 = n6?.niveau5;
            const n4 = n5?.niveau4 || n6?.niveau4;
            const n3 = n4?.niveau3 || n5?.niveau3 || n6?.niveau3;
            const n2 = n3?.niveau2;
            const n1 = n2?.niveau1;

            // Derive Origine from price fields
            let derivedOrigine = articleData.Origine;
            if (articleData.Prix_consulte && articleData.Prix_consulte !== '0' && articleData.Prix_consulte !== '') {
                derivedOrigine = 'Consulté';
            } else if (articleData.Prix_estime && articleData.Prix_estime !== '0' && articleData.Prix_estime !== '') {
                derivedOrigine = 'Estimé';
            } else if (articleData.Prix_Cible && articleData.Prix_Cible !== '0' && articleData.Prix_Cible !== '') {
                derivedOrigine = 'Cible';
            }

            return {
                ...articleData,
                Niveau_1: n1?.niveau_1 || null,
                Niveau_2__lot: n2?.niveau_2 || null,
                Niveau_3: n3?.niveau_3 || null,
                Niveau_4: n4?.niveau_4 || null,
                Niveau_5__article: n5?.niveau_5 || null,
                Niveau_6__detail_article: n6?.niveau_6 || null,
                Origine: derivedOrigine
            };
        });

        res.status(200).json({
            success: true,
            data: transformedArticles,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching articles:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching articles',
            error: error.message
        });
    }
};

/**
 * Get article by ID
 * GET /api/articles/:id
 */
exports.getArticleById = async (req, res) => {
    try {
        const { id } = req.params;

        const article = await Article.findByPk(id, {
            include: [
                {
                    model: Niveau6,
                    as: 'niveau6',
                    include: [
                        {
                            model: Niveau5,
                            as: 'niveau5',
                            include: [
                                {
                                    model: Niveau4,
                                    as: 'niveau4',
                                    include: [
                                        {
                                            model: Niveau3,
                                            as: 'niveau3',
                                            include: [
                                                {
                                                    model: Niveau2,
                                                    as: 'niveau2',
                                                    include: [
                                                        {
                                                            model: Niveau1,
                                                            as: 'niveau1'
                                                        }
                                                    ]
                                                }
                                            ]
                                        }
                                    ]
                                },
                                {
                                    model: Niveau3,
                                    as: 'niveau3',
                                    include: [
                                        {
                                            model: Niveau2,
                                            as: 'niveau2',
                                            include: [
                                                {
                                                    model: Niveau1,
                                                    as: 'niveau1'
                                                }
                                            ]
                                        }
                                    ]
                                }
                            ]
                        },
                        {
                            model: Niveau4,
                            as: 'niveau4',
                            include: [
                                {
                                    model: Niveau3,
                                    as: 'niveau3',
                                    include: [
                                        {
                                            model: Niveau2,
                                            as: 'niveau2',
                                            include: [
                                                {
                                                    model: Niveau1,
                                                    as: 'niveau1'
                                                }
                                            ]
                                        }
                                    ]
                                }
                            ]
                        },
                        {
                            model: Niveau3,
                            as: 'niveau3',
                            include: [
                                {
                                    model: Niveau2,
                                    as: 'niveau2',
                                    include: [
                                        {
                                            model: Niveau1,
                                            as: 'niveau1'
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'nom_utilisateur', 'email']
                },
                {
                    model: Fournisseur,
                    as: 'fournisseurData'
                }
            ]
        });

        if (!article) {
            return res.status(404).json({
                success: false,
                message: 'Article not found'
            });
        }

        // Transform nested Niveau data to flat structure with fallbacks for skips
        const articleData = article.toJSON();

        // Helper to find the deepest value in the hierarchy
        const findNiveauData = (n6) => {
            const n5 = n6?.niveau5;
            const n4 = n5?.niveau4 || n6?.niveau4;
            const n3 = n4?.niveau3 || n5?.niveau3 || n6?.niveau3;
            const n2 = n3?.niveau2;
            const n1 = n2?.niveau1;

            return {
                Niveau_1: n1?.niveau_1 || null,
                Niveau_2__lot: n2?.niveau_2 || null,
                Niveau_3: n3?.niveau_3 || null,
                Niveau_4: n4?.niveau_4 || null,
                Niveau_5__article: n5?.niveau_5 || null,
                Niveau_6__detail_article: n6?.niveau_6 || null,
            };
        };

        const hierarchy = findNiveauData(articleData.niveau6);

        // Derive Origine from price fields
        let derivedOrigine = articleData.Origine;
        if (articleData.Prix_consulte && articleData.Prix_consulte !== '0' && articleData.Prix_consulte !== '') {
            derivedOrigine = 'Consulté';
        } else if (articleData.Prix_estime && articleData.Prix_estime !== '0' && articleData.Prix_estime !== '') {
            derivedOrigine = 'Estimé';
        } else if (articleData.Prix_Cible && articleData.Prix_Cible !== '0' && articleData.Prix_Cible !== '') {
            derivedOrigine = 'Cible';
        }

        const transformedData = {
            ...articleData,
            ...hierarchy,
            Origine: derivedOrigine
        };

        res.status(200).json({
            success: true,
            data: transformedData
        });
    } catch (error) {
        console.error('Error fetching article:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching article',
            error: error.message
        });
    }
};

/**
 * Update article
 * PUT /api/articles/:id
 */
exports.updateArticle = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const article = await Article.findByPk(id);
        if (!article) {
            return res.status(404).json({
                success: false,
                message: 'Article not found'
            });
        }

        // If updating id_niv_6, verify it exists
        if (updateData.id_niv_6) {
            const niveau6Exists = await Niveau6.findByPk(updateData.id_niv_6);
            if (!niveau6Exists) {
                return res.status(404).json({
                    success: false,
                    message: 'Niveau 6 not found'
                });
            }
        }

        await article.update(updateData);

        // Fetch updated article with associations
        const updatedArticle = await Article.findByPk(id, {
            include: [
                {
                    model: Niveau6,
                    as: 'niveau6',
                    include: [
                        {
                            model: Niveau5,
                            as: 'niveau5',
                            include: [
                                {
                                    model: Niveau4,
                                    as: 'niveau4',
                                    include: [
                                        {
                                            model: Niveau3,
                                            as: 'niveau3',
                                            include: [
                                                {
                                                    model: Niveau2,
                                                    as: 'niveau2',
                                                    include: [
                                                        {
                                                            model: Niveau1,
                                                            as: 'niveau1'
                                                        }
                                                    ]
                                                }
                                            ]
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'nom_utilisateur', 'email']
                },
                {
                    model: Fournisseur,
                    as: 'fournisseurData'
                }
            ]
        });

        res.status(200).json({
            success: true,
            message: 'Article updated successfully',
            data: updatedArticle
        });
    } catch (error) {
        console.error('Error updating article:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating article',
            error: error.message
        });
    }
};

/**
 * Delete article
 * DELETE /api/articles/:id
 */
exports.deleteArticle = async (req, res) => {
    try {
        const { id } = req.params;
        const { deletedBy } = req.body; // Admin email/name who deleted it

        const article = await Article.findByPk(id);
        if (!article) {
            return res.status(404).json({
                success: false,
                message: 'Article not found'
            });
        }

        // Archive the article to articles_supprime before deleting
        await ArticleSupprime.create({
            ID: article.ID,
            Date: article.Date,
            nom_article: article.nom_article,
            Unite: article.Unite,
            Type: article.Type,
            Expertise: article.Expertise,
            Fourniture: article.Fourniture,
            Cadence: article.Cadence,
            Accessoires: article.Accessoires,
            Pertes: article.Pertes,
            PU: article.PU,
            Prix_Cible: article.Prix_Cible,
            Prix_estime: article.Prix_estime,
            Prix_consulte: article.Prix_consulte,
            Rabais: article.Rabais,
            Commentaires: article.Commentaires,
            User: article.User,
            Indice_de_confiance: article.Indice_de_confiance,
            files: article.files,
            deleted_by: deletedBy || 'Unknown',
            fournisseur: article.fournisseur,
            id_niv_6: article.id_niv_6
        });

        // Now delete from articles table
        await article.destroy();

        res.status(200).json({
            success: true,
            message: 'Article archived and deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting article:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting article',
            error: error.message
        });
    }
};
/**
 * Get unique article names for a given Niveau 6
 * GET /api/articles/names?id_niv_6=...&niveau_6=...
 */
exports.getArticleNames = async (req, res) => {
    try {
        const { id_niv_6, niveau_6 } = req.query;
        let whereClause = {};

        if (id_niv_6 && id_niv_6 !== 'null' && id_niv_6 !== 'undefined') {
            whereClause.id_niv_6 = id_niv_6;
        } else if (niveau_6) {
            // Find all matching Niveau 6 IDs for this label
            const n6s = await Niveau6.findAll({ where: { niveau_6: niveau_6 } });
            if (n6s.length === 0) return res.status(200).json({ success: true, data: [] });
            whereClause.id_niv_6 = n6s.map(n => n.id_niveau_6);
        } else {
            return res.status(400).json({ success: false, message: 'id_niv_6 or niveau_6 is required' });
        }

        const articles = await Article.findAll({
            where: whereClause,
            attributes: [
                [Sequelize.fn('DISTINCT', Sequelize.col('nom_article')), 'nom_article']
            ],
            order: [['nom_article', 'ASC']],
            raw: true
        });

        res.status(200).json({
            success: true,
            data: articles
        });
    } catch (error) {
        console.error('Error fetching article names:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching article names',
            error: error.message
        });
    }
};
/**
 * Get all unique Unité values from the articles table
 * GET /api/articles/units
 */
exports.getUniqueUnits = async (req, res) => {
    try {
        const units = await Article.findAll({
            attributes: ['Unite'],
            group: ['Unite'],
            where: {
                Unite: {
                    [require('sequelize').Op.ne]: null,
                    [require('sequelize').Op.ne]: ''
                }
            },
            order: [['Unite', 'ASC']]
        });

        res.status(200).json({
            success: true,
            data: units.map(u => u.Unite)
        });
    } catch (error) {
        console.error('Error fetching unique units:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching unique units',
            error: error.message
        });
    }
};
