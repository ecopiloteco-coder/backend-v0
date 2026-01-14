const request = require('supertest');

// Mock DB pool (not used directly here but prevent env access)
jest.mock('../../config/db', () => ({
  query: jest.fn(),
  connect: jest.fn(async () => ({ query: jest.fn(), release: jest.fn() })),
  end: jest.fn(),
}));

// Mock auth middleware to inject a test user
jest.mock('../middleware/authMiddleware', () => ({
  authMiddleware: (req, res, next) => {
    req.user = { id: 1, is_admin: true, nom_utilisateur: 'Tester' };
    next();
  },
  adminMiddleware: (req, res, next) => next(),
  authAdminMiddleware: [(req, res, next) => next()],
}));

// Mock supabase upload (already in jest.setup, but keep here if test runs standalone)
jest.mock('../utils/supabase', () => ({
  supabase: null,
  uploadBufferToBucket: jest.fn(async (buffer, filename) => ({ path: `mock/${filename}`, publicUrl: `https://files.test/${filename}` })),
}));

// Mock Article model create
jest.mock('../models/Article', () => ({
  create: jest.fn(async (payload) => ({ ID: 123, ...payload })),
  checkArticleExists: jest.fn(async () => ({ exists: false })),
}));

const app = require('../app');

describe('POST /api/articles', () => {
  it('creates an article with file_urls and returns 201', async () => {
    const res = await request(app)
      .post('/api/articles')
      .set('Authorization', 'Bearer test')
      .send({
        Niveau_6__detail_article: 'Test Article',
        Unite: 'pcs',
        Type: 'type',
        Date: '2024-01-01',
        Expertise: 'expert',
        PU: '10.50',
        Prix_Cible: '0',
        Prix_estime: '0',
        Prix_consulte: '0',
        file_urls: JSON.stringify([
          { url: 'https://files.test/doc.pdf', filename: 'doc.pdf', size: 11 },
        ]),
      });

    // Controller returns 201 on success; if our mock layer surfaces 500, treat as failure
    expect([201]).toContain(res.status);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data');
    const { data } = res.body;
    expect(data).toHaveProperty('files');
  });
});


