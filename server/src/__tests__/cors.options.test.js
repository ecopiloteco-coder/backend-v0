const request = require('supertest');
const app = require('../app');

describe('CORS preflight for uploads endpoint', () => {
  test('OPTIONS responds with CORS headers', async () => {
    const res = await request(app)
      .options('/api/uploads/signed-url')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type, Authorization');

    expect([200, 204]).toContain(res.status);
    expect(res.headers['access-control-allow-origin']).toBeDefined();
    expect(res.headers['access-control-allow-headers']).toBeDefined();
  });
});


