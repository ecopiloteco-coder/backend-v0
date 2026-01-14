const {
    PendingArticle,
    Article,
    Niveau6,
    Niveau5,
    Niveau4,
    Niveau3,
    Niveau2,
    Niveau1,
    User,
    Fournisseur
} = require('../models');

/**
 * Get all pending articles (admin only)
 * GET /api/pending-articles
 */
exports.getAllPendingArticles = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 30,
            status = 'En attente', // Default to pending only
            sortBy = 'submitted_at',
            sortOrder = 'DESC'
        } = req.query;
        const offset = (page - 1) * limit;

        const whereClause = {};
        if (status && status !== 'all') {
            // Use case-insensitive matching for status
            whereClause.status = {
                [require('sequelize').Op.iLike]: status
            };
        }

        console.log('🔍 Fetching pending articles with whereClause:', whereClause);
        console.log('📊 Query params:', { page, limit, status, sortBy, sortOrder });

        const { count, rows: pendingArticles } = await PendingArticle.findAndCountAll({
            where: whereClause,
            limit: parseInt(limit),
            offset: parseInt(offset),
            distinct: true,
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'nom_utilisateur', 'email']
                },
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
                                            required: false,
                                            include: [
                                                {
                                                    model: Niveau2,
                                                    as: 'niveau2',
                                                    required: false,
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
                                    required: false,
                                    include: [
                                        {
                                            model: Niveau2,
                                            as: 'niveau2',
                                            required: false,
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
                            required: false,
                            include: [
                                {
                                    model: Niveau2,
                                    as: 'niveau2',
                                    required: false,
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
                    model: Fournisseur,
                    as: 'fournisseurData'
                }
            ],
            order: [[sortBy, sortOrder.toUpperCase()]]
        });

        // Flatten hierarchy for each article and derive Origine
        const transformedArticles = pendingArticles.map(article => {
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

        console.log('✅ Found pending articles count:', count);
        console.log('📄 Articles returned:', transformedArticles.length);

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
        console.error('Error fetching pending articles:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching pending articles',
            error: error.message
        });
    }
};

/**
 * Get pending articles for a specific user
 * GET /api/pending-articles/user/:userId
 */
exports.getUserPendingArticles = async (req, res) => {
    try {
        const { userId } = req.params;
        const {
            page = 1,
            limit = 30,
            sortBy = 'submitted_at',
            sortOrder = 'DESC'
        } = req.query;
        const offset = (page - 1) * limit;

        const { count, rows: pendingArticles } = await PendingArticle.findAndCountAll({
            where: { created_by: userId },
            limit: parseInt(limit),
            offset: parseInt(offset),
            distinct: true,
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
                                            required: false,
                                            include: [
                                                {
                                                    model: Niveau2,
                                                    as: 'niveau2',
                                                    required: false,
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
                                    required: false,
                                    include: [
                                        {
                                            model: Niveau2,
                                            as: 'niveau2',
                                            required: false,
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
                            required: false,
                            include: [
                                {
                                    model: Niveau2,
                                    as: 'niveau2',
                                    required: false,
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
                    model: Fournisseur,
                    as: 'fournisseurData'
                }
            ],
            order: [[sortBy, sortOrder.toUpperCase()]]
        });

        // Flatten hierarchy and derive Origine
        const transformedArticles = pendingArticles.map(article => {
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
        console.error('Error fetching user pending articles:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching user pending articles',
            error: error.message
        });
    }
};

/**
 * Get a single pending article by ID
 * GET /api/pending-articles/:id
 */
exports.getPendingArticleById = async (req, res) => {
    try {
        const { id } = req.params;

        const article = await PendingArticle.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'nom_utilisateur', 'email']
                },
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
                                            required: false,
                                            include: [
                                                {
                                                    model: Niveau2,
                                                    as: 'niveau2',
                                                    required: false,
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
                                    required: false,
                                    include: [
                                        {
                                            model: Niveau2,
                                            as: 'niveau2',
                                            required: false,
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
                            required: false,
                            include: [
                                {
                                    model: Niveau2,
                                    as: 'niveau2',
                                    required: false,
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
                    model: Fournisseur,
                    as: 'fournisseurData'
                }
            ]
        });

        if (!article) {
            return res.status(404).json({
                success: false,
                message: 'Pending article not found'
            });
        }

        const articleData = article.toJSON();
        const n6 = articleData.niveau6;
        const n5 = n6?.niveau5;
        const n4 = n5?.niveau4 || n6?.niveau4;
        const n3 = n4?.niveau3 || n5?.niveau3 || n6?.niveau3;
        const n2 = n3?.niveau2;
        const n1 = n2?.niveau1;

        // Derive Origine
        let derivedOrigine = articleData.Origine;
        if (articleData.Prix_consulte && articleData.Prix_consulte !== '0' && articleData.Prix_consulte !== '') {
            derivedOrigine = 'Consulté';
        } else if (articleData.Prix_estime && articleData.Prix_estime !== '0' && articleData.Prix_estime !== '') {
            derivedOrigine = 'Estimé';
        } else if (articleData.Prix_Cible && articleData.Prix_Cible !== '0' && articleData.Prix_Cible !== '') {
            derivedOrigine = 'Cible';
        }

        const transformedArticle = {
            ...articleData,
            Niveau_1: n1?.niveau_1 || null,
            Niveau_2__lot: n2?.niveau_2 || null,
            Niveau_3: n3?.niveau_3 || null,
            Niveau_4: n4?.niveau_4 || null,
            Niveau_5__article: n5?.niveau_5 || null,
            Niveau_6__detail_article: n6?.niveau_6 || null,
            Origine: derivedOrigine
        };

        res.status(200).json({
            success: true,
            data: transformedArticle
        });
    } catch (error) {
        console.error('Error fetching pending article:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching pending article',
            error: error.message
        });
    }
};

/**
 * Approve a pending article (admin only)
 * POST /api/pending-articles/:id/approve
 */
exports.approvePendingArticle = async (req, res) => {
    try {
        const { id } = req.params;
        const { reviewedBy } = req.body; // Admin user name/email

        // Find the pending article
        const pendingArticle = await PendingArticle.findByPk(id);
        if (!pendingArticle) {
            return res.status(404).json({
                success: false,
                message: 'Pending article not found'
            });
        }

        if (pendingArticle.status !== 'En attente') {
            return res.status(400).json({
                success: false,
                message: `Article has already been ${pendingArticle.status.toLowerCase()}`
            });
        }

        // Create the approved article in articles table
        const approvedArticle = await Article.create({
            Date: pendingArticle.Date,
            nom_article: pendingArticle.nom_article,
            Unite: pendingArticle.Unite,
            Type: pendingArticle.Type,
            Expertise: pendingArticle.Expertise,
            Fourniture: pendingArticle.Fourniture,
            Cadence: pendingArticle.Cadence,
            Accessoires: pendingArticle.Accessoires,
            Pertes: pendingArticle.Pertes,
            PU: pendingArticle.PU,
            Prix_Cible: pendingArticle.Prix_Cible,
            Prix_estime: pendingArticle.Prix_estime,
            Prix_consulte: pendingArticle.Prix_consulte,
            Rabais: pendingArticle.Rabais,
            Commentaires: pendingArticle.Commentaires,
            User: pendingArticle.created_by,
            Indice_de_confiance: pendingArticle.Indice_de_confiance,
            files: pendingArticle.files,
            fournisseur: pendingArticle.fournisseur,
            id_niv_6: pendingArticle.id_niv_6
        });

        // Update pending article status
        await pendingArticle.update({
            status: 'Approuvé',
            reviewed_by: reviewedBy,
            reviewed_at: new Date(),
            updated_at: new Date(),
            approved_article_id: approvedArticle.ID
        });

        res.status(200).json({
            success: true,
            message: 'Article approved successfully',
            data: {
                pendingArticle,
                approvedArticle
            }
        });
    } catch (error) {
        console.error('Error approving article:', error);
        res.status(500).json({
            success: false,
            message: 'Error approving article',
            error: error.message
        });
    }
};

/**
 * Reject a pending article (admin only)
 * POST /api/pending-articles/:id/reject
 */
exports.rejectPendingArticle = async (req, res) => {
    try {
        const { id } = req.params;
        const { rejectedBy, reason } = req.body;

        const pendingArticle = await PendingArticle.findByPk(id);
        if (!pendingArticle) {
            return res.status(404).json({
                success: false,
                message: 'Pending article not found'
            });
        }

        if (pendingArticle.status !== 'En attente') {
            return res.status(400).json({
                success: false,
                message: `Article has already been ${pendingArticle.status.toLowerCase()}`
            });
        }

        // Update status to rejected
        await pendingArticle.update({
            status: 'Rejeté',
            rejected_by: rejectedBy,
            reviewed_at: new Date(),
            updated_at: new Date(),
            Commentaires: reason ? `${pendingArticle.Commentaires || ''}\n\n[REJET]: ${reason}` : pendingArticle.Commentaires
        });

        res.status(200).json({
            success: true,
            message: 'Article rejected successfully',
            data: pendingArticle
        });
    } catch (error) {
        console.error('Error rejecting article:', error);
        res.status(500).json({
            success: false,
            message: 'Error rejecting article',
            error: error.message
        });
    }
};

/**
 * Update a pending article
 * PUT /api/pending-articles/:id
 */
exports.updatePendingArticle = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        const { userId, isAdmin } = req.body; // Expecting userId and isAdmin from frontend

        // Find the pending article
        const pendingArticle = await PendingArticle.findByPk(id);
        if (!pendingArticle) {
            return res.status(404).json({
                success: false,
                message: 'Pending article not found'
            });
        }

        // Check if article is still pending or rejected
        if (pendingArticle.status !== 'En attente' && pendingArticle.status !== 'Rejeté') {
            return res.status(400).json({
                success: false,
                message: `Cannot edit article with status: ${pendingArticle.status}`
            });
        }

        // Authorization check: User must own the article OR be an admin
        if (!isAdmin && pendingArticle.created_by !== userId) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to edit this article'
            });
        }

        // Remove metadata fields from update
        delete updateData.userId;
        delete updateData.isAdmin;
        delete updateData.ID;
        delete updateData.created_by;
        delete updateData.status;
        delete updateData.submitted_at;
        delete updateData.reviewed_by;
        delete updateData.reviewed_at;
        delete updateData.approved_article_id;

        // Update the pending article
        await pendingArticle.update({
            ...updateData,
            status: 'En attente', // Reset status to pending if it was rejected
            updated_at: new Date()
        });

        // Fetch updated article with associations
        const updatedArticle = await PendingArticle.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'nom_utilisateur', 'email']
                },
                {
                    model: Niveau6,
                    as: 'niveau6',
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
                                            required: false,
                                            include: [
                                                {
                                                    model: Niveau2,
                                                    as: 'niveau2',
                                                    required: false,
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
                                    required: false,
                                    include: [
                                        {
                                            model: Niveau2,
                                            as: 'niveau2',
                                            required: false,
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
                            required: false,
                            include: [
                                {
                                    model: Niveau2,
                                    as: 'niveau2',
                                    required: false,
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
                    model: Fournisseur,
                    as: 'fournisseurData'
                }
            ]
        });

        if (!updatedArticle) {
            return res.status(404).json({
                success: false,
                message: 'Article not found after update'
            });
        }

        // Transform and derive Origine
        const articleData = updatedArticle.toJSON();
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

        const transformedData = {
            ...articleData,
            Niveau_1: n1?.niveau_1 || null,
            Niveau_2__lot: n2?.niveau_2 || null,
            Niveau_3: n3?.niveau_3 || null,
            Niveau_4: n4?.niveau_4 || null,
            Niveau_5__article: n5?.niveau_5 || null,
            Niveau_6__detail_article: n6?.niveau_6 || null,
            Origine: derivedOrigine
        };

        res.status(200).json({
            success: true,
            message: 'Pending article updated successfully',
            data: transformedData
        });
    } catch (error) {
        console.error('Error updating pending article:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating pending article',
            error: error.message
        });
    }
};

/**
 * Delete a pending article
 * DELETE /api/pending-articles/:id
 */
exports.deletePendingArticle = async (req, res) => {
    try {
        const { id } = req.params;

        const pendingArticle = await PendingArticle.findByPk(id);
        if (!pendingArticle) {
            return res.status(404).json({
                success: false,
                message: 'Pending article not found'
            });
        }

        // Only allow deletion if status is 'En attente'
        if (pendingArticle.status !== 'En attente') {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete article that has been reviewed'
            });
        }

        await pendingArticle.destroy();

        res.status(200).json({
            success: true,
            message: 'Pending article deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting pending article:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting pending article',
            error: error.message
        });
    }
};
