const request = require('supertest');

// Mock DB pool for this suite
const mockConnect = jest.fn();
jest.mock('../../config/db', () => ({
  query: jest.fn(),
  connect: (...args) => mockConnect(...args),
  end: jest.fn(),
}));

// Auth middleware injects user (already in jest.setup), no extra mock needed

const app = require('../app');

beforeEach(() => {
  mockConnect.mockReset();
});

describe('Project routes basic coverage', () => {
  it('POST /api/projects returns 400 when nom_projet missing', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', 'Bearer test')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('success', false);
  });

  it('GET /api/projects/:id returns 400 for invalid id', async () => {
    const res = await request(app)
      .get('/api/projects/not-a-number')
      .set('Authorization', 'Bearer test');
    expect(res.status).toBe(400);
  });

  it('GET /api/projects/my-projects returns empty list (mocked)', async () => {
    // Mock a client with query returning empty rows and total 0
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] }) // listSql
        .mockResolvedValueOnce({ rows: [{ total: 0 }] }), // countSql
      release: jest.fn(),
    };
    mockConnect.mockResolvedValueOnce(client);

    const res = await request(app)
      .get('/api/projects/my-projects')
      .set('Authorization', 'Bearer test');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data');
  });

  it('GET /api/projects (admin) returns list (mocked)', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] }) // list
        .mockResolvedValueOnce({ rows: [{ total: 0 }] }), // count
      release: jest.fn(),
    };
    mockConnect.mockResolvedValueOnce(client);

    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', 'Bearer test');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  it('GET /api/projects/:id returns 404 when not found (mocked)', async () => {
    // First query is access check → empty rows
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] }), // access check
      release: jest.fn(),
    };
    mockConnect.mockResolvedValueOnce(client);

    const res = await request(app)
      .get('/api/projects/123')
      .set('Authorization', 'Bearer test');
    expect(res.status).toBe(404);
  });
});


