const {
    Projet, Client, User, ProjetEquipe, ProjetLot, Ouvrage, Bloc, Structure, ProjetArticle, Article, Niveau2
} = require('../models');

/**
 * Get full project details with hierarchy
 * GET /api/projets/:id/details
 */
exports.getProjetDetails = async (req, res) => {
    try {
        const { id } = req.params;

        const project = await Projet.findByPk(id, {
            include: [
                {
                    model: Client,
                    as: 'clientData'
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'nom_utilisateur', 'email']
                },
                {
                    model: ProjetEquipe,
                    as: 'teamMembers',
                    include: [
                        {
                            model: User,
                            as: 'userData',
                            attributes: ['id', 'nom_utilisateur', 'email']
                        }
                    ]
                },
                {
                    model: ProjetLot,
                    as: 'lots',
                    attributes: ['id_projet_lot', 'id_projet', 'id_lot', 'designation_lot', 'prix_total', 'prix_vente'],
                    include: [
                        {
                            model: Niveau2,
                            as: 'lotData',
                            attributes: ['id_niveau_2', 'niveau_2']
                        },
                        {
                            model: Ouvrage,
                            as: 'ouvrages',
                            include: [
                                // Direct articles under Ouvrage
                                {
                                    model: Structure,
                                    as: 'structures',
                                    where: { bloc: null }, // Only direct ouvrage structures
                                    required: false,
                                    include: [
                                        {
                                            model: ProjetArticle,
                                            as: 'articles',
                                            include: [
                                                {
                                                    model: Article,
                                                    as: 'articleData'
                                                }
                                            ]
                                        }
                                    ]
                                },
                                // Blocs under Ouvrage
                                {
                                    model: Bloc,
                                    as: 'blocs',
                                    include: [
                                        {
                                            model: Structure,
                                            as: 'structures',
                                            include: [
                                                {
                                                    model: ProjetArticle,
                                                    as: 'articles',
                                                    include: [
                                                        {
                                                            model: Article,
                                                            as: 'articleData'
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
                }
            ],
            order: [
                // Order lots, ouvrages, etc. if needed
                [{ model: ProjetLot, as: 'lots' }, 'id_projet_lot', 'ASC'],
                [{ model: ProjetLot, as: 'lots' }, { model: Ouvrage, as: 'ouvrages' }, 'id', 'ASC']
            ]
        });

        if (!project) {
            return res.status(404).json({
                success: false,
                message: 'Project not found'
            });
        }

        // Calculate Pricing Summaries
        let totalLotTTC = 0;
        let totalVenteLot = 0;
        let totalProjetTTC = 0;
        let totalVenteProjet = 0;

        // Iterate through hierarchy to calculate totals
        if (project.lots) {
            project.lots.forEach(lot => {
                let lotTTC = 0;
                let lotVente = 0;

                if (lot.ouvrages) {
                    lot.ouvrages.forEach(ouvrage => {
                        // Calculate from Blocks
                        if (ouvrage.blocs) {
                            ouvrage.blocs.forEach(bloc => {
                                if (bloc.structures) {
                                    bloc.structures.forEach(struct => {
                                        if (struct.articles) {
                                            struct.articles.forEach(article => {
                                                lotTTC += (article.total_ttc || 0);
                                                // Assuming margin logic applies to sales price, 
                                                // or using specific sales price field if exists. 
                                                // For now aggregating total_ttc as a base cost
                                            });
                                        }
                                    });
                                }
                            });
                        }

                        // Calculate from direct Ouvrage structures
                        if (ouvrage.structures) {
                            ouvrage.structures.forEach(struct => {
                                if (struct.articles) {
                                    struct.articles.forEach(article => {
                                        lotTTC += (article.total_ttc || 0);
                                    });
                                }
                            });
                        }
                    });
                }

                // Use stored values if available, otherwise calculated
                totalLotTTC += (lot.prix_total || lotTTC);
                totalVenteLot += (lot.prix_vente || 0); // Need to define how this is calculated
            });
        }

        // Aggregate project totals
        totalProjetTTC = totalLotTTC; // Sum of all lots
        totalVenteProjet = totalVenteLot; // Sum of all lots sales

        res.status(200).json({
            success: true,
            data: {
                project,
                pricing: {
                    totalLotTTC,
                    totalVenteLot,
                    totalProjetTTC,
                    totalVenteProjet
                }
            }
        });

    } catch (error) {
        console.error('Error fetching project details:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching project details',
            error: error.message
        });
    }
};
