import { resetPasswordError, resetToken } from '../src/features/auth/resetLink';

const token = 'A'.repeat(48);

test('accepts raw reset tokens and approved SemiTraX fragment links', () => {
  expect(resetToken(token)).toBe(token);
  expect(
    resetToken('https://www.semitrax.com/reset-password.html#token=' + token),
  ).toBe(token);
});

test('rejects query tokens, other origins, credentials and ambiguous fragments', () => {
  for (const value of [
    'https://www.semitrax.com/reset-password.html?token=' + token,
    'https://semitrax.com/reset-password.html#token=' + token,
    'https://attacker.invalid/reset#token=' + token,
    'https://user:pass@www.semitrax.com/reset-password.html#token=' + token,
    'https://www.semitrax.com/reset-password.html#token=' + token + '&next=x',
    'https://www.semitrax.com/reset-password.html#token=' + token + '&token=' + token,
  ]) {
    expect(resetToken(value)).toBeNull();
  }
});

test('password replacement enforces length, UTF-8 byte limit and confirmation', () => {
  expect(resetPasswordError('short', 'short')).toBe('Use at least 10 characters.');
  expect(resetPasswordError('x'.repeat(73), 'x'.repeat(73))).toBe(
    'Use at most 72 UTF-8 bytes.',
  );
  expect(resetPasswordError('valid password', 'other password')).toBe(
    'Passwords do not match.',
  );
  expect(resetPasswordError('valid password', 'valid password')).toBeNull();
});
