/** Parse only a token; never navigate to, persist, or log the pasted link. */
export function resetToken(input: string): string | null {
  if (input.length > 4096) return null;
  let token = input.trim();
  if (token.startsWith('https://')) {
    try {
      const link = new URL(token);
      if (link.username || link.password) return null;
      // Emails deliberately carry credentials in the fragment to keep them out
      // of website logs/referrers. Continue accepting older query links, but
      // never choose between duplicate or conflicting credentials.
      const candidates = [
        ...link.searchParams.getAll('token'),
        ...new URLSearchParams(link.hash.slice(1)).getAll('token'),
      ];
      if (candidates.length !== 1) return null;
      token = candidates[0]!;
    } catch {
      return null;
    }
  }
  return !/\s/.test(token) && /^[A-Za-z0-9_-]{40,256}$/.test(token)
    ? token
    : null;
}

/** Automatic opening has a narrower trust boundary than explicitly pasting a token. */
export function automaticResetToken(input: string): string | null {
  try {
    if (input.length > 4096) return null;
    const url = new URL(input);
    if (
      url.origin !== 'https://www.semitrax.com' ||
      url.username ||
      url.password ||
      !['/reset-password', '/reset-password.html'].includes(url.pathname)
    )
      return null;
    return resetToken(input);
  } catch {
    return null;
  }
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
