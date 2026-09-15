export type Environment = Readonly<{
  apiUrl: string;
  mapboxToken: string;
  release: boolean;
}>;

export function validateApiUrl(value: string, release: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('SEMITRAX_API_URL must be an absolute URL.');
  }
  if (
    !/^https?:$/.test(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Use an HTTP(S) backend URL without credentials, query or fragment.',
    );
  }
  const host = url.hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '');
  const privateHost =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '::1' ||
    host === '::' ||
    host.startsWith('::ffff:') ||
    (host.includes(':') && /^(f[cd]|fe[89ab])/.test(host)) ||
    /^(127|0|10)\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '10.0.3.2' ||
    !host.includes('.');
  if (release && (url.protocol !== 'https:' || privateHost)) {
    throw new Error(
      'Release requires an explicit public HTTPS SemiTraX backend.',
    );
  }
  return url.toString().replace(/\/$/, '');
}

export function createEnvironment(
  apiUrl: string,
  mapboxToken: string,
  release: boolean,
): Environment {
  if (mapboxToken && !mapboxToken.startsWith('pk.')) {
    throw new Error(
      'Only a public pk. Mapbox display token belongs in the app.',
    );
  }
  return Object.freeze({
    apiUrl: validateApiUrl(apiUrl, release),
    mapboxToken,
    release,
  });
}
