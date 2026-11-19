import { expect, it } from 'vitest';
import { canDelete, managementLocked } from '../../src/app/room-controls';
import { parseRoom } from '../../src/firebase/model';
it('locks running management while retaining the legacy readonly deletion exception', () => {
  expect(managementLocked('running')).toBe(true);
  expect(canDelete('running')).toBe(false);
  expect(canDelete('paused')).toBe(false);
  expect(canDelete('running', true)).toBe(true);
  expect(canDelete('ended')).toBe(true);
  expect(canDelete('deleting')).toBe(true);
});
it('recovers deleting room metadata independently of obsolete timer and question fields', () => {
  const room = parseRoom('r1', { code: 'ABC123', ownerUid: 'owner', status: 'deleting', rulesVersion: 2 });
  expect(room.status).toBe('deleting');
  expect(room.code).toBe('ABC123');
  expect(() => parseRoom('unknown', { code: 'ABC123', ownerUid: 'owner', status: 'deleting', rulesVersion: 3 })).toThrow();
});
