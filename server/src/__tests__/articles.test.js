const request = require('supertest');

// Mock DB pool to avoid real database
jest.mock('../../config/db', () => ({
  query: jest.fn(),
  connect: jest.fn(async () => ({ query: jest.fn(), release: jest.fn() })),
  end: jest.fn(),
}));

// Mock Article model used by the controller
jest.mock('../models/Article', () => ({
  findAll: jest.fn(async () => ({
    data: [
      {
        ID: 1,
        Niveau_6__detail_article: 'Article A',
        Unite: 'pcs',
        Type: 'type1',
        Expertise: 'expert',
        Date: '2024-01-01',
      },
      {
        ID: 2,
        Niveau_6__detail_article: 'Article B',
        Unite: 'm',
        Type: 'type2',
        Expertise: 'expert',
        Date: '2024-01-02',
      },
    ],
    count: 2,
    totalCount: 2,
    totalPages: 1,
    currentPage: 1,
  })),
}));

const app = require('../app');

describe('GET /api/articles', () => {
  it('returns paginated list with metadata', async () => {
    const res = await request(app).get('/api/articles').expect(200);
    expect(res.body).toHaveProperty('success', true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('count', 2);
    expect(res.body).toHaveProperty('totalCount', 2);
    expect(res.body).toHaveProperty('totalPages', 1);
    expect(res.body).toHaveProperty('currentPage', 1);
    if (res.body.data.length > 0) {
      expect(res.body.data[0]).toHaveProperty('Niveau_6__detail_article');
    }
  });
});


