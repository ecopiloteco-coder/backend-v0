const express = require('express');
const router = express.Router();
const UserController = require('../controllers/UserController');
const { body } = require('express-validator');

const validateLogin = [
  body('email').isEmail().withMessage('Email invalide'),
  body('mot_de_passe').notEmpty().withMessage('Mot de passe requis'),
];

// Keep existing path used by frontend
router.post('/shared/login', validateLogin, UserController.login);

// Add legacy/expected path for tests and clients
router.post('/login', validateLogin, UserController.login);

router.post('/logout', (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  res.clearCookie('refreshToken', { httpOnly: true, secure: !!isProd, sameSite: isProd ? 'None' : 'Lax', path: '/' });
  res.clearCookie('token', { secure: !!isProd, sameSite: isProd ? 'None' : 'Lax', path: '/' });
  return res.json({ success: true, message: 'Déconnexion réussie' });
});

router.post('/refresh', (req, res) => {
  const rt = req.cookies?.refreshToken || null;
  if (!rt) return res.status(401).json({ success: false, message: 'No refresh token' });
  if (typeof rt !== 'string' || rt.split('.').length !== 3) {
    return res.status(403).json({ success: false, message: 'Invalid refresh token' });
  }
  return res.json({ success: true });
});

module.exports = router;
