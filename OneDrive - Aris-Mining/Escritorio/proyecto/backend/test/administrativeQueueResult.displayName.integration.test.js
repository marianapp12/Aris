import fs from 'fs/promises';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/createApp.js';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('GET /api/users/administrative/queue-requests/:id/result (displayName)', () => {
  let prevResultsUnc;
  const readSpy = vi.spyOn(fs, 'readFile');

  beforeEach(() => {
    prevResultsUnc = process.env.AD_QUEUE_RESULTS_UNC;
    process.env.AD_QUEUE_RESULTS_UNC = 'C:\\mock-ad-results';
    readSpy.mockResolvedValue(
      JSON.stringify({
        status: 'success',
        message: 'Usuario creado en Active Directory.',
        requestId: UUID,
        displayName: 'Ana María Gómez',
        samAccountName: 'agomez',
        userPrincipalName: 'agomez@example.com',
        email: 'agomez@example.com',
      })
    );
  });

  afterEach(() => {
    readSpy.mockReset();
    if (prevResultsUnc !== undefined) {
      process.env.AD_QUEUE_RESULTS_UNC = prevResultsUnc;
    } else {
      delete process.env.AD_QUEUE_RESULTS_UNC;
    }
  });

  it('expone displayName leído del archivo resultado-*.json', async () => {
    const app = createApp();
    const res = await request(app).get(
      `/api/users/administrative/queue-requests/${UUID}/result`
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.displayName).toBe('Ana María Gómez');
    expect(res.body.userPrincipalName).toBe('agomez@example.com');
    expect(res.body.email).toBe('agomez@example.com');
    expect(res.body.samAccountName).toBe('agomez');
    expect(readSpy).toHaveBeenCalled();
  });
});
