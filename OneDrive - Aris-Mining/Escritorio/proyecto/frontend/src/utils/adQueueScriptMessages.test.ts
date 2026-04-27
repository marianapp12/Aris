import { describe, expect, it } from 'vitest';
import { isAdScriptDuplicateEmployeeIdMessage } from './adQueueScriptMessages';

describe('adQueueScriptMessages — isAdScriptDuplicateEmployeeIdMessage', () => {
  it('detecta mensaje con "misma cédula"', () => {
    expect(isAdScriptDuplicateEmployeeIdMessage('Error: misma cédula en AD')).toBe(
      true
    );
  });

  it('detecta variante sin tilde y employeeid', () => {
    expect(
      isAdScriptDuplicateEmployeeIdMessage('Conflicto con employeeid existente')
    ).toBe(true);
  });

  it('no marca mensajes genéricos', () => {
    expect(isAdScriptDuplicateEmployeeIdMessage('Timeout de red')).toBe(false);
  });
});
