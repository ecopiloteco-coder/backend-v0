const { Client, sequelize } = require('../models');

// Get all clients
exports.getAllClients = async (req, res) => {
    try {
        const clients = await Client.findAll();

        // Try to get project counts if possible
        // Since we don't have a Project model, we can try a raw query
        let clientsWithCounts = clients;
        try {
            const [counts] = await sequelize.query(`
                SELECT client, COUNT(*) as "projetsCount" 
                FROM projets 
                GROUP BY client
            `);
            const countsMap = counts.reduce((acc, row) => {
                acc[row.client] = parseInt(row.projetsCount);
                return acc;
            }, {});

            clientsWithCounts = clients.map(c => ({
                ...c.toJSON(),
                projetsCount: parseInt(countsMap[c.id]) || 0
            }));
        } catch (e) {
            console.error('Error fetching project counts:', e);
            // If raw query fails, just return clients with 0 counts
            clientsWithCounts = clients.map(c => ({
                ...c.toJSON(),
                projetsCount: 0
            }));
        }

        res.json({ success: true, data: clientsWithCounts });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get client by ID
exports.getClientById = async (req, res) => {
    try {
        const client = await Client.findByPk(req.params.id);
        if (!client) {
            return res.status(404).json({ success: false, message: 'Client non trouvé' });
        }
        res.json({ success: true, data: client });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Create client
exports.createClient = async (req, res) => {
    try {
        const client = await Client.create(req.body);
        res.status(201).json({ success: true, data: client });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// Update client
exports.updateClient = async (req, res) => {
    try {
        const client = await Client.findByPk(req.params.id);
        if (!client) {
            return res.status(404).json({ success: false, message: 'Client non trouvé' });
        }
        await client.update(req.body);
        res.json({ success: true, data: client });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// Delete client
exports.deleteClient = async (req, res) => {
    try {
        const client = await Client.findByPk(req.params.id);
        if (!client) {
            return res.status(404).json({ success: false, message: 'Client non trouvé' });
        }

        // Check for associated projects before deleting
        try {
            const [countResult] = await sequelize.query(`SELECT COUNT(*) as count FROM projets WHERE client = ${client.id}`);
            if (countResult[0] && countResult[0].count > 0) {
                return res.status(400).json({ success: false, message: 'Impossible de supprimer un client avec des projets associés' });
            }
        } catch (e) {
            console.error('Error checking projects before deletion:', e);
        }

        await client.destroy();
        res.json({ success: true, message: 'Client supprimé' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
