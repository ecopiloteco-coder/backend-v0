const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const { testConnection } = require('./config/database');
const errorHandler = require('./middleware/errorHandler');

// Import routes
const articleRoutes = require('./routes/articleRoutes');
const pendingArticleRoutes = require('./routes/pendingArticleRoutes');
const niveauRoutes = require('./routes/niveauRoutes');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const fournisseurRoutes = require('./routes/fournisseurRoutes');
const clientRoutes = require('./routes/clientRoutes');
const projetRoutes = require('./routes/projetRoutes');
const ouvrageRoutes = require('./routes/ouvrageRoutes');
const blocRoutes = require('./routes/blocRoutes');
const eventRoutes = require('./routes/eventRoutes');

// Initialize express app
const app = express();

// Middleware
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'EcoPilot Backend API is running',
        timestamp: new Date().toISOString()
    });
});

// Root endpoint - redirect to frontend
app.get('/', (req, res) => {
    // Redirect to frontend auth page
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
    res.redirect(`${frontendUrl}/auth`);
});

// API Routes
app.use('/api/articles', articleRoutes);
app.use('/api/pending-articles', pendingArticleRoutes);
app.use('/api/niveaux', niveauRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/fournisseurs', fournisseurRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/projets', projetRoutes);
app.use('/api/projet-details', require('./routes/projetDetailsRoutes')); // New route for full details
app.use('/api/ouvrages', ouvrageRoutes);
app.use('/api/blocs', blocRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/notifications', require('./routes/notificationRoutes'));

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;

const startServer = async () => {
    try {
        // Test database connection
        await testConnection();

        // Start listening
        app.listen(PORT, () => {
            console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🚀 EcoPilot Backend API Server                          ║
║                                                            ║
║   📡 Server running on port: ${PORT}                       ║
║   🌍 Environment: ${process.env.NODE_ENV || 'development'}                      ║
║   🔗 Health check: http://localhost:${PORT}/health         ║
║                                                            ║
║   📚 API Endpoints:                                        ║
║   • POST   /api/articles        - Create article          ║
║   • GET    /api/articles        - Get all articles        ║
║   • GET    /api/articles/:id    - Get article by ID       ║
║   • PUT    /api/articles/:id    - Update article          ║
║   • DELETE /api/articles/:id    - Delete article          ║
║                                                            ║
║   • GET    /api/niveaux         - Get hierarchy tree      ║
║   • GET    /api/niveaux/1       - Get Niveau 1            ║
║   • GET    /api/niveaux/2       - Get Niveau 2            ║
║   • GET    /api/niveaux/3       - Get Niveau 3            ║
║   • GET    /api/niveaux/4       - Get Niveau 4            ║
║   • GET    /api/niveaux/5       - Get Niveau 5            ║
║   • GET    /api/niveaux/6       - Get Niveau 6            ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
      `);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

module.exports = app;
