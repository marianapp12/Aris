import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/createApp.js';

describe('createApp (integración HTTP)', () => {
  const app = createApp();

  it('GET /health responde 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('POST /api/users/operational sin datos responde 400', async () => {
    const res = await request(app).post('/api/users/operational').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('POST /api/users sin datos administrativos responde 400', async () => {
    const res = await request(app).post('/api/users').send({});
    expect(res.status).toBe(400);
  });

  it('GET resultado de cola con id no UUID responde 400', async () => {
    const res = await request(app).get(
      '/api/users/administrative/queue-requests/not-a-uuid/result'
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/formato válido/i);
  });

  it('GET resultado de cola con UUID válido y sin AD_QUEUE_* responde 503', async () => {
    const res = await request(app).get(
      '/api/users/administrative/queue-requests/550e8400-e29b-41d4-a716-446655440000/result'
    );
    expect(res.status).toBe(503);
  });

  it('GET /api/users/administrative/next-username sin AD_QUEUE_EMAIL_DOMAIN responde 503', async () => {
    const prev = process.env.AD_QUEUE_EMAIL_DOMAIN;
    delete process.env.AD_QUEUE_EMAIL_DOMAIN;
    try {
      const res = await request(app).get(
        '/api/users/administrative/next-username?givenName=Juan&surname1=Perez'
      );
      expect(res.status).toBe(503);
    } finally {
      if (prev !== undefined) process.env.AD_QUEUE_EMAIL_DOMAIN = prev;
    }
  });

  it('rechaza JSON mayor al límite de express.json (413)', async () => {
    const res = await request(app)
      .post('/api/users/operational')
      .set('Content-Type', 'application/json')
      .send(`{"x":"${'a'.repeat(200_000)}"}`);
    expect(res.status).toBe(413);
  });
});
