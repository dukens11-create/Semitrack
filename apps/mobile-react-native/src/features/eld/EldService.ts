import { z } from 'zod';
import type { ApiClient } from '../../services/api/ApiClient';
export const eldProviders = ['SAMSARA', 'MOTIVE'] as const;
export type EldProvider = (typeof eldProviders)[number];
const connectionSchema = z.object({
  provider: z.enum(eldProviders),
  status: z.string(),
  lastSyncedAt: z.string().nullable(),
  lastErrorCode: z.string().nullable().optional(),
});
export type EldConnection = z.infer<typeof connectionSchema>;
export function authorizedEldUrl(provider: EldProvider, raw: string) {
  const url = new URL(raw);
  const expected =
    provider === 'SAMSARA'
      ? 'https://api.samsara.com/oauth2/authorize'
      : 'https://gomotive.com/oauth/authorize';
  if (
    url.origin + url.pathname !== expected ||
    url.username ||
    url.password ||
    url.hash ||
    url.searchParams.get('response_type') !== 'code' ||
    !url.searchParams.get('state') ||
    !url.searchParams.get('client_id')
  )
    throw new Error('ELD authorization address is invalid.');
  return url.toString();
}
export class EldService {
  constructor(private api: ApiClient) {}
  async connections(signal?: AbortSignal) {
    return z
      .object({ items: z.array(connectionSchema) })
      .parse(
        await this.api.request('GET', '/eld/connections', undefined, signal),
      ).items;
  }
  async connect(provider: EldProvider) {
    const data = z
      .object({ authorizeUrl: z.string() })
      .parse(
        await this.api.request('POST', '/eld/' + provider + '/connect', {}),
      );
    return authorizedEldUrl(provider, data.authorizeUrl);
  }
  async sync(provider: EldProvider) {
    await this.api.request('POST', '/eld/' + provider + '/sync', {});
  }
  async disconnect(provider: EldProvider) {
    await this.api.request('DELETE', '/eld/' + provider);
  }
  async hos(signal?: AbortSignal) {
    // Current API deliberately withholds clocks until signed-in driver mapping is proven.
    const data = z
      .object({
        status: z.string(),
        reason: z.string().optional(),
        certifiedEld: z.boolean(),
      })
      .parse(
        await this.api.request('GET', '/eld/hos/current', undefined, signal),
      );
    return {
      status: 'UNKNOWN' as const,
      reason: data.reason ?? 'DRIVER_MAPPING_REQUIRED',
    };
  }
}
