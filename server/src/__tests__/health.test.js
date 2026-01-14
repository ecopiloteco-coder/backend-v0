const request = require('supertest');

// Mock DB pool to avoid touching real database in tests
jest.mock('../../config/db', () => ({
  query: jest.fn(),
  connect: jest.fn(async () => ({ query: jest.fn(), release: jest.fn() })),
  end: jest.fn(),
}));

const app = require('../app');

describe('Health check', () => {
  it('GET / should respond 200 with health text', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Backend is running');
  });
});


