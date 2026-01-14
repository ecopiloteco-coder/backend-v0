const request = require('supertest');

jest.mock('../../config/db', () => ({
  query: jest.fn(),
  connect: jest.fn(async () => ({ query: jest.fn(), release: jest.fn() })),
  end: jest.fn(),
}));

jest.mock('../middleware/authMiddleware', () => ({
  authMiddleware: (req, res, next) => { req.user = { id: '2', is_admin: false }; next(); },
  adminMiddleware: (req, res, next) => next(),
}));

jest.mock('../models/User', () => ({
  updatePasswordById: jest.fn(async () => true),
}));

const app = require('../app');

describe('PUT /api/users/:id/password', () => {
  it('400 for short password', async () => {
    const res = await request(app)
      .put('/api/users/2/password')
      .set('Authorization', 'Bearer test')
      .send({ new_password: '123' });
    expect(res.status).toBe(400);
  });

  it('403 when updating other user password', async () => {
    const res = await request(app)
      .put('/api/users/3/password')
      .set('Authorization', 'Bearer test')
      .send({ new_password: '123456' });
    expect(res.status).toBe(403);
  });
});


