const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const UserController = require('../controllers/UserController');
const { authMiddleware, adminMiddleware } = require('../middleware/authMiddleware');

// --- Validators ---
const validateCreateUser = [
  body('email').isEmail(),
  body('mot_de_passe').isLength({ min: 6 }),
  body('nom_utilisateur').notEmpty(),
  body('titre_poste').optional().isString(),
  body('is_admin').optional().isBoolean(),
];

const validateUpdateUser = [
  body('email').optional().isEmail(),
  body('nom_utilisateur').optional().notEmpty(),
  body('titre_poste').optional().isString(),
  body('is_admin').optional().isBoolean(),
];

const validatePasswordUpdate = [
  body('current_password').notEmpty(),
  body('new_password').isLength({ min: 6 }),
];

// --- Routes ---
router.post('/mot-de-passe-oublie', UserController.forgotPassword);
router.post('/reset-password', UserController.resetPassword);

// Admin only
router.post('/', authMiddleware, adminMiddleware, validateCreateUser, UserController.createUser);
router.get('/', authMiddleware, adminMiddleware, UserController.getAllUsers);
router.get('/search', authMiddleware, adminMiddleware, UserController.searchUsers);
router.get('/stats', authMiddleware, adminMiddleware, UserController.getUserStats);
router.delete('/:id', authMiddleware, adminMiddleware, UserController.deleteUser);

// Admin or self can view
router.get('/:id', authMiddleware, UserController.getUserById);

// Admin or self can update
router.put('/:id', authMiddleware, validateUpdateUser, UserController.updateUser);

// Only self can update password
router.put('/:id/password', authMiddleware, validatePasswordUpdate, UserController.updatePassword);

module.exports = router;
