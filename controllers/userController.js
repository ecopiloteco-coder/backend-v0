const { User } = require('../models');

/**
 * Get all users
 * GET /api/users
 */
exports.getAllUsers = async (req, res) => {
    try {
        const users = await User.findAll({
            attributes: ['id', 'nom_utilisateur', 'email', 'titre_poste', 'is_admin', 'date_creation_compte'],
            order: [['date_creation_compte', 'DESC']]
        });

        res.status(200).json({
            success: true,
            data: users
        });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération des utilisateurs',
            error: error.message
        });
    }
};

/**
 * Update user
 * PUT /api/users/:id
 */
exports.updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { nom_utilisateur, email, titre_poste, is_admin } = req.body;

        const user = await User.findByPk(id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        await user.update({
            nom_utilisateur,
            email,
            titre_poste,
            is_admin
        });

        res.status(200).json({
            success: true,
            message: 'Utilisateur mis à jour avec succès',
            data: user
        });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la mise à jour de l\'utilisateur',
            error: error.message
        });
    }
};

/**
 * Delete user
 * DELETE /api/users/:id
 */
exports.deleteUser = async (req, res) => {
    try {
        const { id } = req.params;
        const user = await User.findByPk(id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        await user.destroy();

        res.status(200).json({
            success: true,
            message: 'Utilisateur supprimé avec succès'
        });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la suppression de l\'utilisateur',
            error: error.message
        });
    }
};
