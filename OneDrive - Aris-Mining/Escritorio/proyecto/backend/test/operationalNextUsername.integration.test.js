import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/services/graphUserService.js', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    getNextAvailableUsername: vi.fn().mockResolvedValue({
      userName: 'mockuser',
      userPrincipalName: 'mockuser@contoso.com',
    }),
  };
});

import { createApp } from '../src/createApp.js';

describe('GET /api/users/next-username (mock Graph)', () => {
  it('responde 200 con propuesta de usuario', async () => {
    const app = createApp();
    const res = await request(app).get(
      '/api/users/next-username?givenName=Pedro&surname1=Sanchez'
    );
    expect(res.status).toBe(200);
    expect(res.body.userName).toBe('mockuser');
    expect(res.body.userPrincipalName).toBe('mockuser@contoso.com');
  });

  it('responde 400 si faltan nombres suficientes', async () => {
    const app = createApp();
    const res = await request(app).get('/api/users/next-username?givenName=Pe&surname1=Lo');
    expect(res.status).toBe(400);
  });
});
