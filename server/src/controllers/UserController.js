const User = require('../models/User');
const { validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendPasswordResetEmail, sendCredentialsEmail } = require('../utils/mailer');
const crypto = require('crypto');
const EventNotificationService = require('../services/EventNotificationService');

// Store reset tokens in memory (consider DB for production)
const passwordResetTokens = new Map();

class UserController {
  // Create a new user
  static async createUser(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Erreurs de validation',
          errors: errors.array(),
        });
      }

      const userData = {
        email: req.body.email,
        nom_utilisateur: req.body.nom_utilisateur || req.body.name,
        titre_poste: req.body.titre_poste || req.body.jobTitle,
        mot_de_passe: req.body.mot_de_passe || req.body.password,
        is_admin: req.body.is_admin ?? req.body.isAdmin ?? false,
      };

      const newUser = await User.create(userData);

      const { email, mot_de_passe } = req.body;
      const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/shared/login`;
      let emailStatus = {
        success: false,
        message: 'Email not sent yet',
      };

      try {
        const sent = await sendCredentialsEmail(email, email, mot_de_passe, loginUrl);
        emailStatus = {
          success: true,
          messageId: sent?.messageId,
        };
      } catch (err) {
        console.error('Error sending credentials email:', err);
        emailStatus = {
          success: false,
          error: err?.message || 'Failed to send credentials email',
        };
      }

      res.status(201).json({
        success: true,
        message: 'Utilisateur créé avec succès',
        data: newUser.toJSON(),
        emailStatus,
      });
      try {
        const actorId = req.user?.id || newUser.id;
        await EventNotificationService.createEventAndNotify({
          action: 'user_created',
          metadata: {
            email: newUser.email,
            nom_utilisateur: newUser.nom_utilisateur,
            is_admin: !!newUser.is_admin,
          },
          userId: actorId,
          projectId: null,
          notifyAdmins: true,
          notifyProjectUsers: false,
        });
      } catch (e) {
        console.error('Failed to notify admins about new user registration:', e?.message || e);
      }
    } catch (error) {
      console.error('Erreur lors de la création de l\'utilisateur:', error);
      if (error.message.includes('unique constraint')) {
        return res.status(409).json({
          success: false,
          message: 'Email ou nom d\'utilisateur déjà existant',
        });
      }
      res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
      });
    }
  }

  // Get all users with pagination
  static async getAllUsers(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;

      const users = await User.findAll(limit, offset);
      const totalUsers = await User.count();
      const totalPages = Math.ceil(totalUsers / limit);

      res.status(200).json({
        success: true,
        data: users.map(user => user.toJSON()),
        pagination: {
          currentPage: page,
          totalPages,
          totalUsers,
          limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      });
    } catch (error) {
      console.error('Erreur lors de la récupération des utilisateurs:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
      });
    }
  }

  // Get a user by id
  static async getUserById(req, res) {
    try {
      const { id } = req.params;
      const userId = parseInt(id, 10);
      const requester = req.user;

      // Validate parsed ID
      if (isNaN(userId)) {
        return res.status(400).json({ success: false, message: "Invalid user ID format" });
      }

      if (!requester.is_admin && requester.id !== userId) {
        return res.status(403).json({ success: false, message: "Accès refusé." });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: "Utilisateur introuvable" });
      }

      res.json(user);
    } catch (error) {
      console.error('Erreur lors de la récupération de l\'utilisateur par id:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
      });
    }
  }

  // Update a user by id
  static async updateUser(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Erreurs de validation',
          errors: errors.array(),
        });
      }

      const { id } = req.params;
      const userId = parseInt(id, 10);
      const requester = req.user;

      // Validate parsed ID
      if (isNaN(userId)) {
        return res.status(400).json({ success: false, message: "Invalid user ID format" });
      }

      if (!requester.is_admin && requester.id !== userId) {
        return res.status(403).json({
          success: false,
          message: "Accès refusé. Vous ne pouvez modifier que votre propre profil.",
        });
      }

      const userData = {
        email: req.body.email,
        nom_utilisateur: req.body.nom_utilisateur || req.body.name,
        titre_poste: req.body.titre_poste || req.body.jobTitle,
      };

      // Only admins can modify is_admin field
      if (requester.is_admin && (req.body.is_admin !== undefined || req.body.isAdmin !== undefined)) {
        userData.is_admin = req.body.is_admin ?? req.body.isAdmin;
      }

      // Remove undefined fields
      Object.keys(userData).forEach(key => userData[key] === undefined && delete userData[key]);

      const updatedUser = await User.updateById(userId, userData);

      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: 'Utilisateur non trouvé',
        });
      }
      try {
        const roleChanged = (req.body.is_admin !== undefined || req.body.isAdmin !== undefined);
        if (requester.is_admin && roleChanged) {
          await EventNotificationService.createEventAndNotify({
            action: 'security_role_updated',
            metadata: {
              target_user_id: userId,
              target_user_email: updatedUser.email,
              target_user_name: updatedUser.nom_utilisateur,
              new_is_admin: !!(req.body.is_admin ?? req.body.isAdmin),
            },
            userId: requester.id,
            projectId: null,
            notifyAdmins: true,
            notifyProjectUsers: false,
          });
        }
      } catch (e) {
        console.error('Failed to notify admins about role update:', e?.message || e);
      }

      res.status(200).json({
        success: true,
        message: 'Utilisateur mis à jour avec succès',
        data: updatedUser.toJSON?.() || updatedUser,
      });
    } catch (error) {
      console.error("Erreur lors de la mise à jour de l'utilisateur:", error);
      if (error.message.includes('unique constraint') || error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          success: false,
          message: "Email ou nom d'utilisateur déjà existant",
        });
      }
      res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
      });
    }
  }

  // Delete a user by id
  static async deleteUser(req, res) {
    try {
      const { id } = req.params;
      const userId = parseInt(id, 10);

      // Validate parsed ID
      if (isNaN(userId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid user ID format",
        });
      }

      // Check if user exists first
      const userExists = await User.findById(userId);
      if (!userExists) {
        return res.status(404).json({
          success: false,
          message: 'Utilisateur non trouvé',
        });
      }

      // Check if user is assigned to any projects
      const projectCheck = await require('../../config/db').query(
        'SELECT COUNT(*) as count FROM projet_equipe WHERE equipe = $1',
        [userId]
      );

      if (parseInt(projectCheck.rows[0].count) > 0) {
        return res.status(409).json({
          success: false,
          message: 'Impossible de supprimer cet utilisateur car il est assigné à un ou plusieurs projets',
          details: {
            projectsCount: parseInt(projectCheck.rows[0].count)
          }
        });
      }

      // Check if user created any projects
      const createdProjectsCheck = await require('../../config/db').query(
        'SELECT COUNT(*) as count FROM projets WHERE "Ajouté_par" = $1',
        [userId]
      );

      if (parseInt(createdProjectsCheck.rows[0].count) > 0) {
        return res.status(409).json({
          success: false,
          message: 'Impossible de supprimer cet utilisateur car il a créé un ou plusieurs projets',
          details: {
            createdProjectsCount: parseInt(createdProjectsCheck.rows[0].count)
          }
        });
      }

      // Start transaction to handle cascading deletes safely
      const client = require('../../config/db');

      try {
        await client.query('BEGIN');

        // 1. Clean up or reassign pending articles created by this user
        await client.query(
          'UPDATE pending_articles SET "created_by" = NULL WHERE "created_by" = $1',
          [userId]
        );

        // 2. Clean up notifications for this user
        await client.query(
          'DELETE FROM notifs WHERE "user_recep" = $1',
          [userId]
        );

        // 3. Clean up events created by this user (set to NULL to preserve events)
        await client.query(
          'UPDATE events SET "user" = NULL WHERE "user" = $1',
          [userId]
        );

        // 4. Now delete the user
        const deleteResult = await client.query(
          'DELETE FROM users WHERE id = $1 RETURNING id',
          [userId]
        );

        if (deleteResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            success: false,
            message: 'Utilisateur non trouvé',
          });
        }

        await client.query('COMMIT');

        res.status(200).json({
          success: true,
          message: 'Utilisateur supprimé avec succès',
        });
      } catch (transactionError) {
        await client.query('ROLLBACK');
        throw transactionError;
      }
    } catch (error) {
      console.error('Erreur lors de la suppression de l\'utilisateur:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  // Search users
  static async searchUsers(req, res) {
    try {
      const { q: searchTerm } = req.query;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;

      if (!searchTerm) {
        return res.status(400).json({
          success: false,
          message: 'Terme de recherche requis',
        });
      }

      const users = await User.search(searchTerm, limit, offset);

      res.status(200).json({
        success: true,
        data: users.map(user => user.toJSON()),
        searchTerm,
        resultsCount: users.length,
      });
    } catch (error) {
      console.error('Erreur lors de la recherche d\'utilisateurs:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
      });
    }
  }

  // Update password by id
  static async updatePassword(req, res) {
    try {
      const { id } = req.params;
      const userId = parseInt(id, 10);
      const { new_password } = req.body;
      const requester = req.user;

      // Validate parsed ID
      if (isNaN(userId)) {
        return res.status(400).json({ success: false, message: "Invalid user ID format" });
      }

      if (!new_password || new_password.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Le mot de passe doit contenir au moins 6 caractères',
        });
      }

      // Only allow self to update password
      if (requester.id !== userId) {
        return res.status(403).json({
          success: false,
          message: "Accès refusé. Vous ne pouvez modifier que votre propre mot de passe.",
        });
      }

      // Increased cost factor to 12 for better security
      const hashedPassword = await bcrypt.hash(new_password, 12);
      const updated = await User.updatePasswordById(userId, hashedPassword);

      if (!updated) {
        return res.status(404).json({
          success: false,
          message: 'Utilisateur non trouvé',
        });
      }
      try {
        await EventNotificationService.createEventAndNotify({
          action: 'security_password_updated',
          metadata: { target_user_id: userId },
          userId: requester.id,
          projectId: null,
          notifyAdmins: true,
          notifyProjectUsers: false,
        });
      } catch (e) {
        console.error('Failed to notify admins about password update:', e?.message || e);
      }

      res.status(200).json({
        success: true,
        message: 'Mot de passe mis à jour avec succès',
      });
    } catch (error) {
      console.error('Erreur lors de la mise à jour du mot de passe:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
      });
    }
  }

  // Get user statistics
  static async getUserStats(req, res) {
    try {
      const totalUsers = await User.count();
      const adminUsers = await User.findAll().then(users =>
        users.filter(user => user.is_admin).length
      );

      res.status(200).json({
        success: true,
        data: {
          totalUsers,
          adminUsers,
          regularUsers: totalUsers - adminUsers,
        },
      });
    } catch (error) {
      console.error('Erreur lors de la récupération des statistiques:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
      });
    }
  }

  // OPTIMIZED login method with timeout protection
  static async login(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Erreurs de validation',
          errors: errors.array(),
        });
      }

      const { email, mot_de_passe } = req.body;

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Login timeout')), 10000)
      );

      // Parallel execution with timeout
      const loginPromise = (async () => {
        const user = await User.findByEmail(email);

        if (!user) {
          return res.status(401).json({
            success: false,
            message: 'Email ou mot de passe incorrect',
          });
        }

        if (!user.mot_de_passe || typeof user.mot_de_passe !== 'string') {
          console.error('Login error: stored password hash missing');
          return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
          });
        }

        // This is the slow operation on weak CPUs
        const isMatch = await bcrypt.compare(mot_de_passe, user.mot_de_passe);

        if (!isMatch) {
          return res.status(401).json({
            success: false,
            message: 'Email ou mot de passe incorrect',
          });
        }

        // Generate tokens
        const payload = {
          id: user.id,
          email: user.email,
          is_admin: user.is_admin,
          nom_utilisateur: user.nom_utilisateur,
        };

        // Optional rememberMe flag from frontend (default: false)
        const rememberMe = !!req.body.rememberMe;

        const jwtSecret = process.env.JWT_SECRET;

        let accessToken;
        // Default: 8 hours, Remember me: 7 days
        const baseExpirySeconds = rememberMe ? (7 * 24 * 60 * 60) : (8 * 60 * 60);

        if (!jwtSecret || jwtSecret === 'dev-insecure-secret') {
          // If JWT_SECRET is not set, sign without secret (development mode)
          console.warn('⚠️  JWT_SECRET not set - signing token without secret (INSECURE - development only)');
          accessToken = jwt.sign(payload, 'dev-insecure-secret', { expiresIn: baseExpirySeconds });
        } else {
          // Normal signing with secret
          accessToken = jwt.sign(payload, jwtSecret, { expiresIn: baseExpirySeconds });
        }

        const isProd = process.env.NODE_ENV === 'production';

        res.cookie('token', accessToken, {
          httpOnly: false,
          secure: isProd,
          sameSite: isProd ? 'strict' : 'lax',
          maxAge: baseExpirySeconds * 1000,
        });

        return res.status(200).json({
          success: true,
          message: 'Connexion réussie',
          accessToken,
          user: {
            id: user.id,
            email: user.email,
            nom_utilisateur: user.nom_utilisateur,
            titre_poste: user.titre_poste,
            is_admin: user.is_admin,
          },
        });
      })();

      await Promise.race([loginPromise, timeoutPromise]);

    } catch (error) {
      if (error.message === 'Login timeout') {
        console.error('Login timeout - bcrypt taking too long');
        return res.status(503).json({
          success: false,
          message: 'Erreur lors de la connexion, veuillez réessayer',
        });
      }

      console.error('Erreur lors de la connexion:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la connexion',
      });
    }
  }

  // List employees (non-admin users)
  static async listEmploye(req, res) {
    try {
      const users = await User.findAll();
      const employes = users.filter(user => !user.is_admin);

      res.status(200).json({
        success: true,
        message: 'Liste des employés récupérée avec succès',
        data: employes.map(u => u.toJSON())
      });
    } catch (error) {
      console.error('Erreur lors de la récupération des employés :', error);
      res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur'
      });
    }
  }

  // Forgot password - generate reset token and send email
  static async forgotPassword(req, res) {
    res.setHeader('Content-Type', 'application/json');

    try {
      if (!req.body || Object.keys(req.body).length === 0) {
        return res.status(400).json({
          success: false,
          message: "Corps de la requête manquant",
        });
      }

      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email requis",
        });
      }

      const user = await User.findByEmail(email);
      if (!user) {
        // Return success for security (don't reveal if email exists)
        return res.status(200).json({
          success: true,
          message: "Si cet email existe, un lien de réinitialisation a été envoyé",
        });
      }

      const resetToken = crypto.randomBytes(32).toString('hex');
      const expires = Date.now() + 60 * 60 * 1000; // 1 hour

      passwordResetTokens.set(resetToken, { email, expires });

      const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/shared/reset-password/${resetToken}?email=${encodeURIComponent(email)}`;

      // Send email asynchronously (don't block response)
      sendPasswordResetEmail(email, resetUrl).catch(err =>
        console.error('Failed to send password reset email:', err)
      );

      try {
        await EventNotificationService.createEventAndNotify({
          action: 'security_password_reset_requested',
          metadata: { email },
          userId: req.user?.id || 0,
          projectId: null,
          notifyAdmins: true,
          notifyProjectUsers: false,
        });
      } catch (e) {
        console.error('Failed to notify admins about password reset request:', e?.message || e);
      }

      return res.status(200).json({
        success: true,
        message: "Un lien de réinitialisation a été envoyé à votre email",
      });
    } catch (error) {
      console.error('Unhandled error in forgotPassword:', error);
      return res.status(500).json({
        success: false,
        message: "Erreur serveur interne",
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  // Reset password - verify token and update password
  static async resetPassword(req, res) {
    try {
      const { token, email, newPassword } = req.body;

      if (!token || !email || !newPassword) {
        return res.status(400).json({
          success: false,
          message: "Paramètres manquants"
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: "Le mot de passe doit contenir au moins 6 caractères"
        });
      }

      const tokenData = passwordResetTokens.get(token);
      if (!tokenData || tokenData.email !== email) {
        return res.status(400).json({
          success: false,
          message: "Token invalide"
        });
      }

      if (tokenData.expires < Date.now()) {
        passwordResetTokens.delete(token);
        return res.status(400).json({
          success: false,
          message: "Token expiré"
        });
      }

      const user = await User.findByEmail(email);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "Utilisateur non trouvé"
        });
      }

      // Store raw password and let the model hash it internally (prevents double hashing)
      await User.updatePassword(user.id, newPassword);

      passwordResetTokens.delete(token);

      return res.status(200).json({
        success: true,
        message: "Mot de passe mis à jour avec succès"
      });

    } catch (error) {
      console.error('resetPassword error:', error);
      res.status(500).json({
        success: false,
        message: "Erreur serveur"
      });
    }
  }
}

module.exports = UserController;
