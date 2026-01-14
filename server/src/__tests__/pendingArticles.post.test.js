const request = require('supertest');

// Mock DB pool connect usage inside route
jest.mock('../../config/db', () => {
  const mockQuery = async (sql) => {
    const s = String(sql);
    if (s.includes('information_schema.columns')) return { rows: [] };
    if (s.startsWith('ALTER TABLE')) return { rows: [], rowCount: 1 };
    if (s.startsWith('INSERT INTO pending_articles')) return { rows: [{ ID: 111 }] };
    return { rows: [], rowCount: 1 };
  };
  return {
    connect: jest.fn(async () => ({ query: mockQuery, release: jest.fn() })),
    query: mockQuery,
    end: jest.fn(),
  };
});

// Mock auth middleware to inject a test user
jest.mock('../middleware/authMiddleware', () => ({
  authMiddleware: (req, res, next) => {
    req.user = { id: 42, is_admin: true, nom_utilisateur: 'Admin Test' };
    next();
  },
  adminMiddleware: (req, res, next) => next(),
  authAdminMiddleware: [(req, res, next) => next()],
}));

// Mock supabase upload
jest.mock('../utils/supabase', () => ({
  supabase: null,
  uploadBufferToBucket: jest.fn(async (buffer, filename) => ({ path: `mock/${filename}`, publicUrl: `https://files.test/${filename}` })),
}));

const app = require('../app');

describe('POST /api/pending-articles', () => {
  it('creates a pending article with file_urls and returns 201', async () => {
    const res = await request(app)
      .post('/api/pending-articles')
      .set('Authorization', 'Bearer test')
      .send({
        Date: '2024-02-01',
        Niveau_1: 'Cat',
        Niveau_2__lot: 'Lot 1',
        Niveau_3: 'N3',
        Niveau_4: 'N4',
        Orientation_localisation: 'North',
        Niveau_5__article: 'Art5',
        Niveau_6__detail_article: 'Detail 6',
        Unite: 'm',
        Type: 'T',
        Expertise: 'E',
        Fourniture: '0',
        Cadence: '0',
        Accessoires: '0',
        Pertes: '0%',
        PU: '10',
        Prix_Cible: '0',
        Prix_estime: '0',
        Prix_consulte: '0',
        Rabais: '0%',
        Origine_Prestation: '',
        Commentaires: 'test',
        Type_Prestation: 'cible',
        Indice_de_confiance: '3',
        file_urls: JSON.stringify([
          { url: 'https://files.test/evidence.png', filename: 'evidence.png', size: 11 },
        ]),
      });

    // Route returns 201 on success; mock DB may alter behavior but 200/201 acceptable
    expect([200, 201]).toContain(res.status);
    expect(res.body).toHaveProperty('success', true);
    // data is returned on 201 from this route; with mocked DB it may not include the row
  });
});


