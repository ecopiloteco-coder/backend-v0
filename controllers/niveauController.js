const {
    Niveau1,
    Niveau2,
    Niveau3,
    Niveau4,
    Niveau5,
    Niveau6,
    Article
} = require('../models');

/**
 * Get complete hierarchy tree
 * GET /api/niveaux
 */
exports.getAllNiveaux = async (req, res) => {
    try {
        // Fetch all levels independently to support skipping
        const [n1s, n2s, n3s, n4s, n5s, n6s] = await Promise.all([
            Niveau1.findAll({ order: [['id_niveau_1', 'ASC']] }),
            Niveau2.findAll({ order: [['id_niveau_2', 'ASC']] }),
            Niveau3.findAll({ order: [['id_niveau_3', 'ASC']] }),
            Niveau4.findAll({ order: [['id_niveau_4', 'ASC']] }),
            Niveau5.findAll({ order: [['id_niveau_5', 'ASC']] }),
            Niveau6.findAll({
                include: [{ model: Article, as: 'articles' }],
                order: [['id_niveau_6', 'ASC']]
            })
        ]);

        // Create data maps for efficient linking
        const n1Map = new Map(n1s.map(i => [i.id_niveau_1, { ...i.toJSON(), niveau2s: [] }]));
        const n2Map = new Map(n2s.map(i => [i.id_niveau_2, { ...i.toJSON(), niveau3s: [] }]));
        const n3Map = new Map(n3s.map(i => [i.id_niveau_3, { ...i.toJSON(), niveau4s: [], niveau5s: [], niveau6s: [] }]));
        const n4Map = new Map(n4s.map(i => [i.id_niveau_4, { ...i.toJSON(), niveau5s: [], niveau6s: [] }]));
        const n5Map = new Map(n5s.map(i => [i.id_niveau_5, { ...i.toJSON(), niveau6s: [] }]));

        // Link N2 to N1
        n2s.forEach(node => {
            const parent = n1Map.get(node.id_niv_1);
            if (parent) parent.niveau2s.push(n2Map.get(node.id_niveau_2));
        });

        // Link N3 to N2
        n3s.forEach(node => {
            const parent = n2Map.get(node.id_niv_2);
            if (parent) parent.niveau3s.push(n3Map.get(node.id_niveau_3));
        });

        // Link N4 to N3
        n4s.forEach(node => {
            const parent = n3Map.get(node.id_niv_3);
            if (parent) parent.niveau4s.push(n4Map.get(node.id_niveau_4));
        });

        // Link N5 to N4 or N3 (Skipping)
        n5s.forEach(node => {
            if (node.id_niv_4 && n4Map.has(node.id_niv_4)) {
                n4Map.get(node.id_niv_4).niveau5s.push(n5Map.get(node.id_niveau_5));
            } else if (node.id_niv_3 && n3Map.has(node.id_niv_3)) {
                n3Map.get(node.id_niv_3).niveau5s.push(n5Map.get(node.id_niveau_5));
            }
        });

        // Link N6 to N5, N4, or N3 (Skipping)
        n6s.forEach(node_raw => {
            const node = { ...node_raw.toJSON(), articles: node_raw.articles || [] };
            if (node.id_niv_5 && n5Map.has(node.id_niv_5)) {
                n5Map.get(node.id_niv_5).niveau6s.push(node);
            } else if (node.id_niv_4 && n4Map.has(node.id_niv_4)) {
                n4Map.get(node.id_niv_4).niveau6s.push(node);
            } else if (node.id_niv_3 && n3Map.has(node.id_niv_3)) {
                n3Map.get(node.id_niv_3).niveau6s.push(node);
            }
        });

        res.status(200).json({
            success: true,
            data: Array.from(n1Map.values())
        });
    } catch (error) {
        console.error('Error fetching niveaux hierarchy:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching niveaux hierarchy',
            error: error.message
        });
    }
};

/**
 * Get children of a specific niveau level
 * GET /api/niveaux/:level/:id/children
 */
exports.getNiveauChildren = async (req, res) => {
    try {
        const { level, id } = req.params;
        let children = [];

        switch (level) {
            case '1':
                children = await Niveau2.findAll({
                    where: { id_niv_1: id },
                    order: [['id_niveau_2', 'ASC']]
                });
                break;
            case '2':
                children = await Niveau3.findAll({
                    where: { id_niv_2: id },
                    order: [['id_niveau_3', 'ASC']]
                });
                break;
            case '3':
                children = await Niveau4.findAll({
                    where: { id_niv_3: id },
                    order: [['id_niveau_4', 'ASC']]
                });
                break;
            case '4':
                children = await Niveau5.findAll({
                    where: { id_niv_4: id },
                    order: [['id_niveau_5', 'ASC']]
                });
                break;
            case '5':
                children = await Niveau6.findAll({
                    where: { id_niv_5: id },
                    order: [['id_niveau_6', 'ASC']]
                });
                break;
            case '6':
                children = await Article.findAll({
                    where: { id_niv_6: id },
                    order: [['ID', 'ASC']]
                });
                break;
            default:
                return res.status(400).json({
                    success: false,
                    message: 'Invalid niveau level. Must be between 1 and 6.'
                });
        }

        res.status(200).json({
            success: true,
            data: children
        });
    } catch (error) {
        console.error('Error fetching niveau children:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching niveau children',
            error: error.message
        });
    }
};

/**
 * Get all Niveau 1
 * GET /api/niveaux/1
 */
exports.getNiveau1 = async (req, res) => {
    try {
        const niveau1s = await Niveau1.findAll({
            order: [['id_niveau_1', 'ASC']]
        });

        res.status(200).json({
            success: true,
            data: niveau1s
        });
    } catch (error) {
        console.error('Error fetching Niveau 1:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching Niveau 1',
            error: error.message
        });
    }
};

/**
 * Get all Niveau 2 for a specific Niveau 1
 * GET /api/niveaux/2?id_niv_1=:id
 */
exports.getNiveau2 = async (req, res) => {
    try {
        const { id_niv_1 } = req.query;
        const whereClause = id_niv_1 ? { id_niv_1 } : {};

        const niveau2s = await Niveau2.findAll({
            where: whereClause,
            include: [
                {
                    model: Niveau1,
                    as: 'niveau1'
                }
            ],
            order: [['id_niveau_2', 'ASC']]
        });

        res.status(200).json({
            success: true,
            data: niveau2s
        });
    } catch (error) {
        console.error('Error fetching Niveau 2:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching Niveau 2',
            error: error.message
        });
    }
};

/**
 * Get all Niveau 3 for a specific Niveau 2
 * GET /api/niveaux/3?id_niv_2=:id
 */
exports.getNiveau3 = async (req, res) => {
    try {
        const { id_niv_2 } = req.query;
        const whereClause = id_niv_2 ? { id_niv_2 } : {};

        const niveau3s = await Niveau3.findAll({
            where: whereClause,
            include: [
                {
                    model: Niveau2,
                    as: 'niveau2'
                }
            ],
            order: [['id_niveau_3', 'ASC']]
        });

        // Remove duplicates based on niveau_3 name
        const uniqueNiveau3s = [];
        const seenNames = new Set();

        for (const item of niveau3s) {
            if (!seenNames.has(item.niveau_3)) {
                seenNames.add(item.niveau_3);
                uniqueNiveau3s.push(item);
            }
        }

        res.status(200).json({
            success: true,
            data: uniqueNiveau3s
        });
    } catch (error) {
        console.error('Error fetching Niveau 3:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching Niveau 3',
            error: error.message
        });
    }
};

/**
 * Get all Niveau 4 for a specific Niveau 3
 * GET /api/niveaux/4?id_niv_3=:id
 */
exports.getNiveau4 = async (req, res) => {
    try {
        const { id_niv_3 } = req.query;
        const whereClause = id_niv_3 ? { id_niv_3 } : {};

        const niveau4s = await Niveau4.findAll({
            where: whereClause,
            include: [
                {
                    model: Niveau3,
                    as: 'niveau3'
                }
            ],
            order: [['id_niveau_4', 'ASC']]
        });

        res.status(200).json({
            success: true,
            data: niveau4s
        });
    } catch (error) {
        console.error('Error fetching Niveau 4:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching Niveau 4',
            error: error.message
        });
    }
};

/**
 * Get all Niveau 5 for a specific Niveau 4
 * GET /api/niveaux/5?id_niv_4=:id
 */
exports.getNiveau5 = async (req, res) => {
    try {
        const { id_niv_4, id_niv_3 } = req.query;
        let whereClause = {};

        if (id_niv_4) {
            whereClause.id_niv_4 = id_niv_4;
        } else if (id_niv_3) {
            whereClause.id_niv_3 = id_niv_3;
        }

        const niveau5s = await Niveau5.findAll({
            where: whereClause,
            include: [
                {
                    model: Niveau4,
                    as: 'niveau4',
                    required: false
                },
                {
                    model: Niveau3,
                    as: 'niveau3',
                    required: false
                }
            ],
            order: [['id_niveau_5', 'ASC']]
        });

        res.status(200).json({
            success: true,
            data: niveau5s
        });
    } catch (error) {
        console.error('Error fetching Niveau 5:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching Niveau 5',
            error: error.message
        });
    }
};

/**
 * Get all Niveau 6 for a specific Niveau 5
 * GET /api/niveaux/6?id_niv_5=:id
 */
exports.getNiveau6 = async (req, res) => {
    try {
        const { id_niv_5, id_niv_4, id_niv_3 } = req.query;
        let whereClause = {};

        if (id_niv_5) {
            whereClause.id_niv_5 = id_niv_5;
        } else if (id_niv_4) {
            whereClause.id_niv_4 = id_niv_4;
        } else if (id_niv_3) {
            whereClause.id_niv_3 = id_niv_3;
        }

        const niveau6s = await Niveau6.findAll({
            where: whereClause,
            include: [
                {
                    model: Niveau5,
                    as: 'niveau5',
                    required: false
                },
                {
                    model: Niveau4,
                    as: 'niveau4',
                    required: false
                },
                {
                    model: Niveau3,
                    as: 'niveau3',
                    required: false
                }
            ],
            order: [['id_niveau_6', 'ASC']]
        });

        res.status(200).json({
            success: true,
            data: niveau6s
        });
    } catch (error) {
        console.error('Error fetching Niveau 6:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching Niveau 6',
            error: error.message
        });
    }
};
