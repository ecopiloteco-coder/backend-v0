const request = require('supertest');

jest.mock('../../config/db', () => ({
  query: jest.fn(),
  connect: jest.fn(async () => ({ query: jest.fn(), release: jest.fn() })),
  end: jest.fn(),
}));

jest.mock('../middleware/authMiddleware', () => ({
  authMiddleware: (req, res, next) => { req.user = { id: 2, is_admin: false, nom_utilisateur: 'U' }; next(); },
  adminMiddleware: (req, res, next) => next(),
}));

jest.mock('../models/Article', () => ({
  create: jest.fn(async (payload) => ({ ID: 100, ...payload })),
  checkArticleExists: jest.fn(async () => ({ exists: false })),
}));

jest.mock('../utils/supabase', () => ({
  uploadBufferToBucket: jest.fn(),
  signedUploadUrlToPublicUrl: (u) => u,
}));

const app = require('../app');

describe('POST /api/articles validation', () => {
  it('400 for missing required fields', async () => {
    const res = await request(app)
      .post('/api/articles')
      .set('Authorization', 'Bearer test')
      .send({ Niveau_6__detail_article: '', Unite: '', Type: '', Date: '', Expertise: '', PU: '' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('success', false);
  });
});


