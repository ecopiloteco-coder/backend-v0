const request = require('supertest');

// Mock DB pool with programmable behavior
const mockQuery = jest.fn(async (sql, params) => {
  const q = String(sql);
  if (q.includes('FROM pending_articles') && q.includes('WHERE "ID" =')) {
    // Return one pending article row
    return {
      rows: [
        {
          ID: 10,
          Date: '2024-01-01',
          Niveau_1: 'Cat',
          Niveau_2__lot: 'Lot',
          Niveau_3: 'N3',
          Niveau_4: '',
          Orientation_localisation: '',
          Niveau_5__article: 'Art5',
          Niveau_6__detail_article: 'Detail 6',
          Unite: 'm',
          Type: 'T',
          Expertise: 'E',
          Fourniture: 0,
          Cadence: 0,
          Accessoires: 0,
          Pertes: '0%',
          PU: '10.00',
          Prix_Cible: '0.00',
          Prix_estime: '0.00',
          Prix_consulte: '0.00',
          Rabais: '0%',
          Origine_Prestation: '',
          Commentaires: '',
          created_by: 42,
          Type_Prestation: 'cible',
          Indice_de_confiance: 3,
          files: JSON.stringify([{ url: 'https://files.test/doc.pdf' }]),
        },
      ],
    };
  }
  if (q.startsWith('INSERT INTO articles')) {
    return { rows: [{ ID: 999 }] };
  }
  if (q.startsWith('UPDATE pending_articles')) {
    return { rows: [], rowCount: 1 };
  }
  if (q.includes('information_schema.columns')) {
    return { rows: [] };
  }
  return { rows: [], rowCount: 0 };
});

jest.mock('../../config/db', () => ({
  connect: jest.fn(async () => ({ query: mockQuery, release: jest.fn() })),
  query: mockQuery,
  end: jest.fn(),
}));

// Mock auth middleware as admin
jest.mock('../middleware/authMiddleware', () => ({
  authMiddleware: (req, res, next) => {
    req.user = { id: 1, is_admin: true, nom_utilisateur: 'Admin' };
    next();
  },
  adminMiddleware: (req, res, next) => next(),
  authAdminMiddleware: [(req, res, next) => next()],
}));

// Mock Supabase upload module to avoid env
jest.mock('../utils/supabase', () => ({
  supabase: null,
  uploadBufferToBucket: jest.fn(async (buffer, filename) => ({ path: `mock/${filename}`, publicUrl: `https://files.test/${filename}` })),
}));

const app = require('../app');

describe('Pending article approval/rejection', () => {
  beforeEach(() => {
    mockQuery.mockClear();
  });

  it('approves a pending article and moves it to articles', async () => {
    const res = await request(app)
      .post('/api/pending-articles/10/approve')
      .set('Authorization', 'Bearer test')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    // Ensure expected queries were called
    const sqls = mockQuery.mock.calls.map(c => String(c[0]));
    expect(sqls.find(s => s.includes('FROM pending_articles'))).toBeTruthy();
    expect(sqls.find(s => s.startsWith('INSERT INTO articles'))).toBeTruthy();
    expect(sqls.find(s => s.startsWith('UPDATE pending_articles'))).toBeTruthy();
  });

  it('rejects a pending article and records status', async () => {
    // For reject flow, SELECT is not strictly necessary, update happens directly
    mockQuery.mockImplementationOnce(async () => ({ rows: [], rowCount: 1 }));

    const res = await request(app)
      .post('/api/pending-articles/10/reject')
      .set('Authorization', 'Bearer test')
      .send({ reason: 'Not valid' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});


