const request = require('supertest');
const app = require('../app');

// Mock auth as non-admin owner id 42
jest.mock('../middleware/authMiddleware', () => ({
  authMiddleware: (req, res, next) => { req.user = { id: 42, is_admin: false, nom_utilisateur: 'User' }; next(); },
  adminMiddleware: (req, res, next) => next(),
}));

// Mock DB minimal for owner check and update
jest.mock('../../config/db', () => {
  const mockQuery = jest.fn((sql, params) => {
    if (sql.includes('SELECT "created_by" FROM pending_articles WHERE "ID" = $1')) {
      return Promise.resolve({ rows: [{ created_by: 42 }], rowCount: 1 });
    }
    if (sql.startsWith('UPDATE pending_articles SET')) {
      return Promise.resolve({ rows: [{ ID: params[0], files: params.find(v => typeof v === 'string' && v.startsWith('[')) }], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  return {
    query: mockQuery,
    connect: jest.fn(async () => ({ query: mockQuery, release: jest.fn() })),
    end: jest.fn(),
  };
});

describe('PUT /api/pending-articles/:id file_urls updates files column', () => {
  test('replaces files with provided JSON (clear)', async () => {
    const res = await request(app)
      .put('/api/pending-articles/55')
      .send({ file_urls: '[]' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  test('sets files to provided URLs', async () => {
    const json = JSON.stringify([{ url: 'https://files.test/x.png', filename: 'x.png', size: 10 }]);
    const res = await request(app)
      .put('/api/pending-articles/55')
      .send({ file_urls: json });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});


