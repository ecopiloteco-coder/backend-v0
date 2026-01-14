const Client = require('../models/Client');

/**
 * Get all clients
 */
exports.getAllClients = async (req, res) => {
    try {
        const { search = '', page = 1, limit = 100 } = req.query;
        
        const clients = await Client.findAll({
            search,
            page: parseInt(page, 10),
            limit: parseInt(limit, 10)
        });

        const total = await Client.count({ search });
        const totalPages = Math.ceil(total / parseInt(limit, 10));

        res.json({
            success: true,
            data: clients,
            pagination: {
                page: parseInt(page, 10),
                limit: parseInt(limit, 10),
                total,
                totalPages
            }
        });
    } catch (error) {
        console.error('Error fetching clients:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * Get client by ID
 */
exports.getClientById = async (req, res) => {
    try {
        const clientId = parseInt(req.params.id, 10);

        if (isNaN(clientId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid client ID'
            });
        }

        const client = await Client.findById(clientId);

        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
            });
        }

        res.json({
            success: true,
            data: client
        });
    } catch (error) {
        console.error('Error fetching client:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * Create a new client
 */
exports.createClient = async (req, res) => {
    try {
        const clientData = req.body;

        if (!clientData.nom_client || clientData.nom_client.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Le nom du client est requis'
            });
        }

        // Check if client name already exists
        const existingClient = await Client.findByName(clientData.nom_client);
        if (existingClient) {
            return res.status(400).json({
                success: false,
                message: 'Un client avec ce nom existe déjà'
            });
        }

        const client = await Client.create(clientData);

        res.status(201).json({
            success: true,
            data: client,
            message: 'Client créé avec succès'
        });
    } catch (error) {
        console.error('Error creating client:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * Update client
 */
exports.updateClient = async (req, res) => {
    try {
        const clientId = parseInt(req.params.id, 10);

        if (isNaN(clientId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid client ID'
            });
        }

        const clientData = req.body;

        // Check if client name already exists (excluding current client)
        if (clientData.nom_client && clientData.nom_client.trim() !== '') {
            const existingClient = await Client.findByName(clientData.nom_client, clientId);
            if (existingClient) {
                return res.status(400).json({
                    success: false,
                    message: 'Un client avec ce nom existe déjà'
                });
            }
        }

        const updatedClient = await Client.update(clientId, clientData);

        if (!updatedClient) {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
            });
        }

        res.json({
            success: true,
            data: updatedClient,
            message: 'Client mis à jour avec succès'
        });
    } catch (error) {
        console.error('Error updating client:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * Delete client
 */
exports.deleteClient = async (req, res) => {
    try {
        const clientId = parseInt(req.params.id, 10);

        if (isNaN(clientId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid client ID'
            });
        }

        await Client.delete(clientId);

        res.json({
            success: true,
            message: 'Client supprimé avec succès'
        });
    } catch (error) {
        console.error('Error deleting client:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};
