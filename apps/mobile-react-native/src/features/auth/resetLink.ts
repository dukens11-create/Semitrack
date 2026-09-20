/** Parse only a token; never navigate to, persist, or log the pasted link. */
export function resetToken(input: string): string | null {
  let token = input.trim();
  if (token.startsWith('https://')) {
    try {
      const link = new URL(token);
      if (
        link.origin !== 'https://www.semitrax.com' ||
        link.username ||
        link.password ||
        link.search
      )
        return null;
      const fragment = new URLSearchParams(link.hash.slice(1));
      if (
        fragment.getAll('token').length !== 1 ||
        [...fragment.keys()].some(key => key !== 'token')
      )
        return null;
      token = fragment.get('token') ?? '';
    } catch {
      return null;
    }
  }
  return /^[A-Za-z0-9_-]{40,256}$/.test(token) ? token : null;
}
export function resetPasswordError(password: string, confirmation: string) {
  if (password.length < 10) return 'Use at least 10 characters.';
  // Same bcrypt UTF-8 limit as the existing API; no truncation.
  let bytes = 0;
  for (const character of password) {
    const code = character.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  if (bytes > 72) return 'Use at most 72 UTF-8 bytes.';
  if (password !== confirmation) return 'Passwords do not match.';
  return null;
}
