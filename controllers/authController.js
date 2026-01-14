const { User } = require('../models');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

/**
 * Register a new user
 * POST /api/auth/signup
 */
exports.signup = async (req, res) => {
    try {
        const { nom_utilisateur, email, mot_de_passe, titre_poste, is_admin } = req.body;

        // Check if user already exists
        const userExists = await User.findOne({ where: { email } });
        if (userExists) {
            return res.status(400).json({
                success: false,
                message: 'Cet email est déjà utilisé'
            });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(mot_de_passe, salt);

        // Create user
        const user = await User.create({
            nom_utilisateur,
            email,
            mot_de_passe: hashedPassword,
            titre_poste,
            is_admin: is_admin || false
        });

        // Generate token
        const token = jwt.sign(
            { id: user.id, is_admin: user.is_admin },
            process.env.JWT_SECRET || 'your_default_jwt_secret',
            { expiresIn: '2h' }
        );

        res.status(201).json({
            success: true,
            message: 'Compte créé avec succès',
            data: {
                id: user.id,
                nom_utilisateur: user.nom_utilisateur,
                email: user.email,
                is_admin: user.is_admin,
                token
            }
        });
    } catch (error) {
        console.error('Error during signup:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la création du compte',
            error: error.message
        });
    }
};

/**
 * Login user
 * POST /api/auth/login
 */
exports.login = async (req, res) => {
    try {
        const { email, mot_de_passe } = req.body;

        // Find user
        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Identifiants invalides'
            });
        }

        // Check password
        const isMatch = await bcrypt.compare(mot_de_passe, user.mot_de_passe);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Identifiants invalides'
            });
        }

        // Generate token
        const token = jwt.sign(
            { id: user.id, is_admin: user.is_admin },
            process.env.JWT_SECRET || 'your_default_jwt_secret',
            { expiresIn: '2h' }
        );

        res.status(200).json({
            success: true,
            data: {
                id: user.id,
                nom_utilisateur: user.nom_utilisateur,
                email: user.email,
                is_admin: user.is_admin,
                token
            }
        });
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la connexion',
            error: error.message
        });
    }
};
