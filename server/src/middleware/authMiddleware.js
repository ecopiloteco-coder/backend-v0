const jwt = require('jsonwebtoken');
const User = require('../models/User'); // Adjust path as needed

// Main authentication middleware
// AUTH_MODE=payload will trust JWT payload and skip DB fetch unless `forceDb` flag is set on the request
const authMiddleware = async (req, res, next) => {
  try {
    let token = req.header('Authorization')?.replace('Bearer ', '');
    // Fallback to cookie token if Authorization header is missing
    if (!token && req.cookies) {
      token = req.cookies.token || req.cookies.accessToken || null;
    }
    // Fallback to query parameter (for SSE/EventSource which can't send headers)
    // This is critical for SSE connections which cannot send Authorization headers
    if (!token && req.query && req.query.token) {
      token = req.query.token;
      console.log('[Auth] Using token from query parameter for SSE connection');
    }
    
    // Debug logging for SSE connections
    if (req.path && req.path.includes('/events')) {
      console.log('[Auth SSE] Path:', req.path, 'Query:', req.query, 'Has token:', !!token);
    }
    
    if (token) {
      const jwtSecret = process.env.JWT_SECRET;
      
      // If JWT_SECRET is not set, decode without verification (development mode)
      let decoded;
      if (!jwtSecret || jwtSecret === 'dev-insecure-secret') {
        console.warn('⚠️  JWT_SECRET not set - decoding token without verification (INSECURE - development only)');
        // Decode without verification
        decoded = jwt.decode(token, { complete: false });
        if (!decoded) {
          console.error('[Auth] Failed to decode token (no secret mode)');
          return res.status(401).json({ success: false, message: 'Token invalide ou malformé' });
        }
        console.log('[Auth] Token decoded successfully (no verification):', { id: decoded.id, email: decoded.email });
      } else {
        // Normal verification with secret
        try {
          decoded = jwt.verify(token, jwtSecret);
          console.log('[Auth] Token verified successfully:', { id: decoded.id, email: decoded.email });
        } catch (verifyError) {
          console.error('[Auth] Token verification failed:', verifyError.message);
          throw verifyError; // Re-throw to be caught by outer catch
        }
      }
      
      const authMode = (process.env.AUTH_MODE || 'db').toLowerCase();

      if (authMode === 'payload' && !req.forceDb) {
        // Trust payload, attach minimal user
        req.user = {
          id: decoded.id,
          email: decoded.email,
          is_admin: decoded.is_admin === true || decoded.is_admin === 'true',
          nom_utilisateur: decoded.nom_utilisateur,
        };
        return next();
      }

      const user = await User.findById(decoded.id);
      if (!user) {
        res.set('X-Session-Expired', '1');
        return res.status(401).json({ success: false, code: 'SESSION_EXPIRED', message: 'Token invalide, utilisateur introuvable' });
      }
      req.user = user;
      return next();
    } else {
      res.set('X-Session-Expired', '1');
      return res.status(401).json({ success: false, code: 'SESSION_EXPIRED', message: 'Aucun token fourni, accès refusé' });
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    
    // If JWT_SECRET is not set, we already handled it above, so this shouldn't happen
    // But if it does, allow the request through in development mode
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret || jwtSecret === 'dev-insecure-secret') {
      console.warn('⚠️  Auth error occurred but JWT_SECRET is not set - allowing request through (development mode)');
      // Create a minimal user object to allow the request to proceed
      req.user = {
        id: 1,
        email: 'dev@example.com',
        is_admin: true,
        nom_utilisateur: 'Development User'
      };
      return next();
    }
    
    if (error && error.name === 'TokenExpiredError') {
      res.set('X-Session-Expired', '1');
      return res.status(401).json({ success: false, code: 'SESSION_EXPIRED', message: 'Session expirée' });
    }
    
    if (error && error.name === 'JsonWebTokenError') {
      // Provide more specific error message for signature errors
      if (error.message === 'invalid signature') {
        console.error('❌ JWT signature verification failed. Possible causes:');
        console.error('   1. JWT_SECRET environment variable mismatch between token creation and verification');
        console.error('   2. Token was signed with a different secret');
        console.error('   3. Environment variable not properly loaded');
        console.error(`   Current JWT_SECRET is set: ${!!jwtSecret}`);
        res.set('X-Session-Expired', '1');
        return res.status(401).json({ 
          success: false, 
          code: 'INVALID_TOKEN', 
          message: 'Token invalide. Veuillez vous reconnecter.' 
        });
      }
    }
    
    return res.status(401).json({ success: false, message: 'Token invalide' });
  }
};


// Admin check middleware
const adminMiddleware = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      success: false, 
      message: 'Utilisateur non authentifié' 
    });
  }

  if (!req.user.is_admin) {
    return res.status(403).json({ 
      success: false, 
      message: 'Accès refusé. Privilèges administrateur requis.' 
    });
  }

  next();
};

// Combined auth + admin middleware
const authAdminMiddleware = [authMiddleware, adminMiddleware];

module.exports = {
  authMiddleware,
  adminMiddleware,
  authAdminMiddleware
};