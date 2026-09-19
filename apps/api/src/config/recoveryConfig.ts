export type RecoveryConfiguration = {
  apiKey: string;
  from: string;
  resetBaseUrl: string;
};

/** Server-only settings. Never use a request Host/Origin header to construct reset links. */
export function parseRecoveryConfiguration(source: Record<string, string | undefined>): RecoveryConfiguration | null {
  const names = ['RESEND_API_KEY', 'PASSWORD_RESET_FROM_EMAIL', 'PASSWORD_RESET_BASE_URL'] as const;
  const configured = names.some(name => Boolean(source[name]?.trim()));
  if (source.NODE_ENV !== 'production' && !configured) return null;
  for (const name of names) {
    if (!source[name]?.trim()) throw new Error(`${name} is required for password recovery`);
  }
  const apiKey = source.RESEND_API_KEY!.trim();
  const from = source.PASSWORD_RESET_FROM_EMAIL!.trim();
  if (!apiKey.startsWith('re_') || /\s/.test(apiKey)) throw new Error('RESEND_API_KEY must be a Resend API key');
  // A mailbox only, without header characters or a display-name parser ambiguity.
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(from)) {
    throw new Error('PASSWORD_RESET_FROM_EMAIL must be a verified sender mailbox');
  }
  let url: URL;
  try { url = new URL(source.PASSWORD_RESET_BASE_URL!.trim()); }
  catch { throw new Error('PASSWORD_RESET_BASE_URL must be an approved HTTPS reset page'); }
  if (url.origin !== 'https://www.semitrax.com' || url.username || url.password ||
      url.search || url.hash || url.pathname === '/') {
    throw new Error('PASSWORD_RESET_BASE_URL must be an HTTPS page on www.semitrax.com without credentials, query or fragment');
  }
  return { apiKey, from, resetBaseUrl: url.href };
}
