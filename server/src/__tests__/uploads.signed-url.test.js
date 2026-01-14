const request = require('supertest');
const app = require('../app');

// Bypass auth
jest.mock('../middleware/authMiddleware', () => ({
  authMiddleware: (req, res, next) => { req.user = { id: 1, is_admin: true, nom_utilisateur: 'Admin' }; next(); },
  adminMiddleware: (req, res, next) => next(),
}));

describe('POST /api/uploads/signed-url', () => {
  test('creates signed url with articles prefix when requested', async () => {
    const res = await request(app)
      .post('/api/uploads/signed-url')
      .send({ filename: 'doc.pdf', contentType: 'application/pdf', prefix: 'articles' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data.signedUrl');
    expect(res.body).toHaveProperty('data.publicUrl');
    // publicUrl should include /upload/articles/
    expect(res.body.data.publicUrl).toContain('/upload/articles/');
  });

  test('falls back to role-based default for invalid prefix (admin -> articles)', async () => {
    const res = await request(app)
      .post('/api/uploads/signed-url')
      .send({ filename: 'img.png', contentType: 'image/png', prefix: 'not-allowed' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    // Since mocked user is admin, invalid prefix should default to 'articles'
    expect(res.body.data.publicUrl).toContain('/upload/articles/');
  });
});


