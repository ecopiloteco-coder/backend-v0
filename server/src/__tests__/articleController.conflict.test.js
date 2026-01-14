const request = require('supertest');

// Mock DB pool to avoid real env/pg
jest.mock('../../config/db', () => ({
  query: jest.fn(),
  connect: jest.fn(async () => ({ query: jest.fn(), release: jest.fn() })),
  end: jest.fn(),
}));

// Mock auth to inject a user id
jest.mock('../middleware/authMiddleware', () => ({
  authMiddleware: (req, res, next) => { req.user = { id: 1, is_admin: true, nom_utilisateur: 'Tester' }; next(); },
  adminMiddleware: (req, res, next) => next(),
}));

// Mock Article model
jest.mock('../models/Article', () => ({
  create: jest.fn(async (payload) => ({ ID: 999, ...payload })),
  checkArticleExists: jest.fn(),
}));

// Mock Supabase utils to pass through urls
jest.mock('../utils/supabase', () => ({
  uploadBufferToBucket: jest.fn(),
  signedUploadUrlToPublicUrl: (u) => u,
}));

const app = require('../app');
const Article = require('../models/Article');

describe('POST /api/articles conflict handling', () => {
  it('409 when article exists with different origin (mismatch)', async () => {
    Article.checkArticleExists.mockResolvedValueOnce({ exists: true, origin: 'estime' });

    const res = await request(app)
      .post('/api/articles')
      .set('Authorization', 'Bearer test')
      .send({
        Niveau_6__detail_article: 'X', Unite: 'u', Type: 't', Date: '2024-01-01', Expertise: 'e',
        PU: '10.00', Prix_Cible: '5', Prix_estime: '0', Prix_consulte: '0',
      });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('success', false);
  });

  it('409 when article exists with same criteria (no origin provided)', async () => {
    Article.checkArticleExists.mockResolvedValueOnce({ exists: true, origin: 'cible' });

    const res = await request(app)
      .post('/api/articles')
      .set('Authorization', 'Bearer test')
      .send({
        Niveau_6__detail_article: 'X', Unite: 'u', Type: 't', Date: '2024-01-01', Expertise: 'e',
        PU: '10.00', Prix_Cible: '0', Prix_estime: '0', Prix_consulte: '0',
      });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('success', false);
  });
});


