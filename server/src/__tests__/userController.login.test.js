const request = require('supertest');

jest.mock('../../config/db', () => ({
  query: jest.fn(),
  connect: jest.fn(async () => ({ query: jest.fn(), release: jest.fn() })),
  end: jest.fn(),
}));

// No auth middleware used for /api/auth/login

jest.mock('../models/User', () => ({
  findByEmail: jest.fn(),
}));

const app = require('../app');
const User = require('../models/User');

describe('POST /api/auth/login', () => {
  it('401 when user not found', async () => {
    User.findByEmail.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'x@example.com', mot_de_passe: 'pass' });
    expect(res.status).toBe(401);
  });

  it('401 when password invalid', async () => {
    const bcrypt = require('bcryptjs');
    jest.spyOn(bcrypt, 'compare').mockResolvedValueOnce(false);
    User.findByEmail.mockResolvedValueOnce({ id: 1, email: 'x@example.com', mot_de_passe: 'hash', is_admin: false, nom_utilisateur: 'X' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'x@example.com', mot_de_passe: 'wrong' });
    expect(res.status).toBe(401);
  });
});


