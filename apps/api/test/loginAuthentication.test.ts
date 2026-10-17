import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticatePassword } from '../dist/services/loginAuthentication.js';
import { hashPassword, comparePassword } from '../dist/utils/password.js';

test('existing bcrypt hashes remain compatible; password is case/whitespace sensitive', async () => {
  const hash = await hashPassword('Isolated fixture password!');
  for (const prefix of ['$2a$','$2b$']) {
    const compatible = prefix + hash.slice(4);
    assert.equal(await comparePassword('Isolated fixture password!',compatible),true);
    assert.equal(await comparePassword('isolated fixture password!',compatible),false);
    assert.equal(await comparePassword('Isolated fixture password! ',compatible),false);
  }
});

test('login normalizes email only, accepts enabled matching account, rejects incorrect/absent/disabled account', async () => {
  const user = {id:'fixture',email:'driver@example.test',disabledAt:null,passwordHash:await hashPassword('Isolated fixture password!')};
  let found: typeof user | null = user;
  const db = {user:{findUnique:async input => {assert.deepEqual(input,{where:{email:'driver@example.test'}});return found;}}};
  assert.equal(await authenticatePassword(db,' Driver@Example.test ','Isolated fixture password!'),user);
  assert.equal(await authenticatePassword(db,'driver@example.test','different fixture password'),null);
  found = {...user,disabledAt:new Date()};
  assert.equal(await authenticatePassword(db,'driver@example.test','Isolated fixture password!'),null);
  found = null;
  assert.equal(await authenticatePassword(db,'driver@example.test','Isolated fixture password!'),null);
});

test('database failure is not mislabeled incorrect credentials and cannot issue a session', async () => {
  await assert.rejects(authenticatePassword({user:{findUnique:async () => {throw Error('database unavailable');}}},
    'driver@example.test','fixture'),{message:'database unavailable'});
});
