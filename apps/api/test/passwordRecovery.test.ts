import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseRecoveryConfiguration } from '../dist/config/recoveryConfig.js';
import { sendRecoveryEmail } from '../dist/services/recoveryEmail.js';
import { requestPasswordRecovery } from '../dist/services/passwordRecovery.js';

const source = { NODE_ENV: 'production', RESEND_API_KEY: 're_unit_test_not_a_credential',
  PASSWORD_RESET_FROM_EMAIL: 'reset@example.test', PASSWORD_RESET_BASE_URL: 'https://www.semitrax.com/reset-password.html' };
const config = parseRecoveryConfiguration(source)!;

test('production recovery requires all server-only settings; development can stay disabled', () => {
  assert.equal(parseRecoveryConfiguration({NODE_ENV:'test'}), null);
  for (const name of ['RESEND_API_KEY','PASSWORD_RESET_FROM_EMAIL','PASSWORD_RESET_BASE_URL']) {
    assert.throws(() => parseRecoveryConfiguration({...source,[name]:''}), new RegExp(name));
  }
  assert.throws(() => parseRecoveryConfiguration({...source,RESEND_API_KEY:'invalid'}), /RESEND_API_KEY/);
  assert.throws(() => parseRecoveryConfiguration({...source,PASSWORD_RESET_FROM_EMAIL:'reset@example.test\r\nBcc: other@example.test'}), /FROM_EMAIL/);
});

test('reset link rejects other hosts, cleartext, embedded credentials and queries/fragments', () => {
  for (const url of ['http://www.semitrax.com/reset','https://www.semitrax.com.attacker.test/reset',
    'https://other.test/reset','https://user:password@www.semitrax.com/reset',
    'https://www.semitrax.com/reset?token=bad','https://www.semitrax.com/reset#bad','https://www.semitrax.com/']) {
    assert.throws(() => parseRecoveryConfiguration({...source,PASSWORD_RESET_BASE_URL:url}), /BASE_URL/);
  }
});

test('Resend request has bounded timeout, no redirect, hashed idempotency key and fragment-only reset token', async () => {
  const token = 'isolated-fixture-token';
  await sendRecoveryEmail(config, 'driver@example.test', token, async (url, request) => {
    assert.equal(url,'https://api.resend.com/emails');
    assert.equal(request.redirect,'error');
    assert.ok(request.signal instanceof AbortSignal);
    assert.equal(request.headers.Authorization,`Bearer ${config.apiKey}`);
    assert.equal(request.headers['Idempotency-Key'],`password-reset/${createHash('sha256').update(token).digest('hex')}`);
    const body = JSON.parse(request.body);
    assert.deepEqual(body.to,['driver@example.test']);
    assert.equal(body.from,config.from);
    const link = new URL(body.text.split('\n\n')[1]);
    assert.equal(link.search,'');
    assert.equal(new URLSearchParams(link.hash.slice(1)).get('token'),token);
    assert.ok(!request.body.includes(config.apiKey));
    return new Response('{}',{status:200});
  });
});

test('Resend rejection, timeout and redirect errors expose no provider body or private values', async () => {
  for (const status of [400,401,403,429,500]) {
    await assert.rejects(sendRecoveryEmail(config,'driver@example.test','secret-fixture-token',async () =>
      new Response('sensitive provider details',{status})), {message:'RECOVERY_DELIVERY_FAILED'});
  }
  await assert.rejects(sendRecoveryEmail(config,'driver@example.test','secret-fixture-token',async () => {
    throw new Error('network error containing a credential');
  }), {message:'RECOVERY_DELIVERY_FAILED'});
});

function fixture(user = {id:'driver', email:'driver@example.test',disabledAt:null}) {
  const writes: any[] = [];
  const db = {user:{findUnique:async input => {assert.equal(input.where.email,'driver@example.test');return user;}},
    passwordResetToken:{create:async input => {writes.push(input);return {id:'reset-id'};},updateMany:async input => {writes.push(input);return {count:1};}}};
  return {db,writes};
}

test('request stores only a hash, delivers once and leaves earlier links/sessions intact', async () => {
  const {db,writes} = fixture();
  let sent = 0;
  await requestPasswordRecovery(db,config,' Driver@Example.test ',() => assert.fail(),async (_config,email,token) => {
    sent++;
    assert.equal(email,'driver@example.test');
    assert.equal(token.length,64);
    assert.equal(writes[0].data.tokenHash,createHash('sha256').update(token).digest('hex'));
    assert.ok(writes[0].data.expiresAt.getTime() - Date.now() <= 3_600_000);
    assert.ok(!JSON.stringify(writes).includes(token));
  });
  assert.equal(sent,1); assert.equal(writes.length,1);
});

test('missing/disabled users have no token or email; delivery failure invalidates only its token without exposing failure', async () => {
  for (const user of [null,{id:'driver',email:'driver@example.test',disabledAt:new Date()}]) {
    const {db,writes} = fixture(user);
    await requestPasswordRecovery(db,config,'driver@example.test',() => assert.fail(),async () => assert.fail());
    assert.equal(writes.length,0);
  }
  const {db,writes} = fixture(); let failures=0;
  await requestPasswordRecovery(db,config,'driver@example.test',() => {failures++;},async () => {throw Error('private provider error');});
  assert.equal(failures,1);
  assert.deepEqual(writes[1].where,{id:'reset-id',usedAt:null});
});
