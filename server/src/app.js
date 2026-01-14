// Load environment variables from .env at process.cwd()
require('dotenv').config({ path: '../../.env' });
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const helmet = require('helmet');
const pool = require('../config/db');
const articleRoutes = require('./routes/articleRoutes');
const pendingArticleRoutes = require('./routes/pendingArticleRoutes');
const userRoutes = require('./routes/UserRoutes');
const adminRoutes = require('./routes/admin.routes');
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projectRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const notificationRoutes = require('./routes/notifications');
const clientRoutes = require('./routes/clientRoutes');
const fournisseurRoutes = require('./routes/fournisseurRoutes');
const referentielRoutes = require('./routes/referentielRoutes');

const app = express();

// Trust upstream proxy (required for secure cookies and HTTPS detection on Render/Proxies)
app.set('trust proxy', 1);

// -------------------- Middleware --------------------
// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disable if using inline scripts
  crossOriginEmbedderPolicy: false
}));

// Rate limiting disabled

// Enable gzip/deflate compression to reduce payload size and speed up responses
app.use(compression());
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
        : [
            'https://www.eco-pilot.com',
            'https://eco-pilot.com',
            'https://frontend-beta-lemon-71.vercel.app',
            'http://localhost:3000',
            'http://localhost:3001'
          ])
    : [
        'http://localhost:3000',
        'http://localhost:3001',
        'https://www.eco-pilot.com',
        'https://eco-pilot.com',
        'https://frontend-beta-lemon-71.vercel.app'
      ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Rate limiters disabled

// Logging (skip in test env)
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'test') {
    console.log(`${req.method} ${req.path} ${JSON.stringify(req.query)}`);
  }
  next();
});

// -------------------- Routes --------------------
app.use('/api/articles', articleRoutes);
app.use('/api/pending-articles', pendingArticleRoutes);
app.use('/api/users', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/fournisseurs', fournisseurRoutes);
app.use('/api/referentiel', referentielRoutes);
app.use('/admin', adminRoutes);

// Root route (Render health check)
app.get('/', (req, res) => res.send('Backend is running 🚀'));

// Ultra-lightweight health route for uptime monitors (no DB, no heavy work)
app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('text/plain').send('OK');
});

// Lightweight health check with quick DB ping (for uptime/cron warmup)
app.get('/healthz', async (req, res) => {
  try {
    // 200 even if DB is temporarily down, but include status payload
    let dbOk = true;
    try {
      await pool.query('SELECT 1');
    } catch (e) {
      dbOk = false;
    }
    res.json({ ok: true, db: dbOk, ts: Date.now() });
  } catch (err) {
    // Never throw from healthz; respond degraded
    res.json({ ok: true, db: false, ts: Date.now() });
  }
});

// Keep-alive endpoint to prevent cold starts (for PM2 and external ping services)
app.get('/keep-alive', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ 
    status: 'alive', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    message: 'Server is running and ready'
  });
});

// Debug DB route (disabled in production)
app.get('/api/debug-db', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Debug route disabled in production' });
  }
  let client;
  try {
    client = await pool.connect();
    const dbResult = await client.query('SELECT current_database(), current_user');
    const tableResult = await client.query('SELECT COUNT(*) FROM articles');
    const lastRows = await client.query('SELECT * FROM articles ORDER BY "ID" DESC LIMIT 3');
    res.json({
      database: dbResult.rows[0],
      totalRows: tableResult.rows[0].count,
      lastThreeRows: lastRows.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (client && typeof client.release === 'function') {
      client.release();
    }
  }
});

// -------------------- Error Handling --------------------
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    console.error('Payload too large:', err.message);
    return res.status(413).json({ error: 'Payload too large' });
  }
  console.error('Unexpected error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;


