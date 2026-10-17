import test from 'node:test';
import assert from 'node:assert/strict';
import { currentAccessSession } from '../dist/services/accessSession.js';
const claims = { userId: 'driver', email: 'driver@example.test', role: 'ADMIN', sessionId: 'session-a', type: 'access' };
test('session lookup binds exact token session, owner, revocation and expiry; returns current database role', async () => {
  const db = { refreshToken: { findFirst: async input => {
    assert.deepEqual({ ...input.where, expiresAt: undefined }, { id:'session-a', userId:'driver', revokedAt:null, expiresAt:undefined });
    assert.ok(input.where.expiresAt.gt instanceof Date);
    return { user: { id:'driver', email:'driver@example.test', role:'DRIVER', disabledAt:null } };
  } } };
  assert.equal((await currentAccessSession(db, claims)).role, 'DRIVER');
});
test('revoked/expired/missing or disabled sessions and legacy unbound tokens fail closed', async () => {
  const missing = { refreshToken: { findFirst: async () => null } };
  assert.equal(await currentAccessSession(missing, claims), null);
  assert.equal(await currentAccessSession({ refreshToken: { findFirst: async () => { throw Error('must not query'); } } }, { ...claims, sessionId: undefined }), null);
  assert.equal(await currentAccessSession({ refreshToken: { findFirst: async () => ({ user:{disabledAt:new Date()} }) } }, claims), null);
});
test('database failure propagates instead of accepting a JWT without server validation', async () => {
  await assert.rejects(currentAccessSession({ refreshToken: { findFirst: async () => { throw Error('offline'); } } }, claims));
});
