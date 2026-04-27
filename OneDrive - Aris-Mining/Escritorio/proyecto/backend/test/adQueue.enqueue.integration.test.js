import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/services/adQueueUserService.js', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    enqueueAdUserRequest: vi.fn(),
  };
});

import { createApp } from '../src/createApp.js';
import { enqueueAdUserRequest } from '../src/services/adQueueUserService.js';

describe('POST /api/users (mock enqueueAdUserRequest)', () => {
  beforeEach(() => {
    vi.mocked(enqueueAdUserRequest).mockReset();
  });

  it('responde 202 cuando el servicio de cola resuelve', async () => {
    vi.mocked(enqueueAdUserRequest).mockResolvedValue({
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      queuePath: '\\\\test-server\\queue\\pending',
      displayName: 'Juan Pérez',
      samAccountName: 'jperez',
      userPrincipalName: 'jperez@example.com',
      queueAction: 'create',
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/users')
      .send({
        givenName: 'Juan',
        surname1: 'Pérez',
        jobTitle: 'Analista',
        department: 'TI',
        employeeId: '987654',
        city: 'Medellín',
        postalCode: '050021',
      });

    expect(res.status).toBe(202);
    expect(res.body.requestId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(res.body.proposedUserName).toBe('jperez');
    expect(vi.mocked(enqueueAdUserRequest)).toHaveBeenCalledOnce();
  });
});
