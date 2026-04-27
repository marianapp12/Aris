import { describe, expect, it } from 'vitest';
import { isValidQueueRequestId } from '../src/utils/queueRequestId.js';

describe('isValidQueueRequestId', () => {
  it('acepta UUID v4 en minúsculas y mayúsculas', () => {
    expect(
      isValidQueueRequestId('550e8400-e29b-41d4-a716-446655440000')
    ).toBe(true);
    expect(
      isValidQueueRequestId('550E8400-E29B-41D4-A716-446655440000')
    ).toBe(true);
  });

  it('rechaza path traversal y valores no UUID', () => {
    expect(isValidQueueRequestId('../../../etc/passwd')).toBe(false);
    expect(isValidQueueRequestId('not-a-uuid')).toBe(false);
    expect(isValidQueueRequestId('550e8400-e29b-41d4-a716-44665544000')).toBe(false);
  });

  it('rechaza vacío', () => {
    expect(isValidQueueRequestId('')).toBe(false);
    expect(isValidQueueRequestId(null)).toBe(false);
  });
});
