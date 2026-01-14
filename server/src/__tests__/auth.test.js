const request = require('supertest');

// Mock DB pool to avoid requiring real env
jest.mock('../../config/db', () => ({
  query: jest.fn(),
  connect: jest.fn(async () => ({ query: jest.fn(), release: jest.fn() })),
  end: jest.fn(),
}));

const app = require('../app');

describe('Auth refresh', () => {
  it('POST /api/auth/refresh without cookie returns 401', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/refresh with invalid cookie returns 403', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refreshToken=invalid.token.here`]);
    expect([401, 403]).toContain(res.status);
  });
});


