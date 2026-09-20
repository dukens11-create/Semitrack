import { SearchService } from '../src/features/search/SearchService';
import { DestinationSearchStore } from '../src/features/search/DestinationSearchStore';
import type { PoiService } from '../src/features/poi/PoiService';

test('search timeout is classified without retrying', async () => {
  jest.useFakeTimers();
  try {
    const transport = jest.fn(
      (_url: RequestInfo, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new Error('private URL')),
          );
        }),
    );
    const search = new SearchService('pk.synthetic-secret', transport);
    const result = search.search('warehouse').catch(error => error);
    await jest.advanceTimersByTimeAsync(15000);
    expect(await result).toMatchObject({ code: 'PLACE_SEARCH_TIMEOUT' });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test('missing public search configuration has a visible safe code and sends nothing', async () => {
  const transport = jest.fn();
  const store = new DestinationSearchStore(
    new SearchService('', transport),
    {} as PoiService,
  );
  store.schedule('warehouse');
  await store.searchNow();
  expect(store.getSnapshot().error).toContain('PLACE_SEARCH_CONFIGURATION');
  expect(transport).not.toHaveBeenCalled();
  store.cancel();
});

test('invalid JSON is rejected without retaining raw provider content', async () => {
  const search = new SearchService(
    'pk.synthetic-secret',
    async () =>
      ({
        ok: true,
        json: async () => {
          throw new Error('private payload');
        },
      } as unknown as Response),
  );
  const error = await search.search('warehouse').catch(value => value);
  expect(error).toMatchObject({ code: 'PLACE_SEARCH_INVALID_RESPONSE' });
  expect(JSON.stringify(error)).not.toContain('private payload');
});

test.each([
  [401, 'PLACE_SEARCH_UNAUTHORIZED'],
  [403, 'PLACE_SEARCH_FORBIDDEN'],
  [429, 'PLACE_SEARCH_RATE_LIMITED'],
  [400, 'PLACE_SEARCH_REQUEST_INVALID'],
  [422, 'PLACE_SEARCH_REQUEST_INVALID'],
  [503, 'PLACE_SEARCH_UNAVAILABLE'],
] as const)(
  'search HTTP %i retains a safe classification, never provider text',
  async (status, code) => {
    const body = jest.fn(async () => ({
      message: 'secret-address token=secret-value',
    }));
    const transport = jest.fn(
      async () => ({ ok: false, status, json: body } as unknown as Response),
    );
    const store = new DestinationSearchStore(
      new SearchService('pk.synthetic-secret', transport),
      {} as PoiService,
    );
    store.schedule('private address');
    await store.searchNow();
    expect(store.getSnapshot().error).toContain(code);
    expect(store.getSnapshot().error).not.toMatch(
      /secret|private address|latitude|longitude/,
    );
    expect(body).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(1);
    store.cancel();
  },
);

test('a raw network error cannot expose its URL, token or query', async () => {
  const store = new DestinationSearchStore(
    new SearchService('pk.synthetic-secret', async () => {
      throw new Error(
        'https://api.mapbox.com/?access_token=pk.synthetic-secret&q=private-address',
      );
    }),
    {} as PoiService,
  );
  store.schedule('private address');
  await store.searchNow();
  expect(store.getSnapshot().error).toContain('PLACE_SEARCH_NETWORK');
  expect(store.getSnapshot().error).not.toMatch(/synthetic|private|https/);
  store.cancel();
});

test('invalid search response remains rejected with a safe classification', async () => {
  const search = new SearchService(
    'pk.synthetic-secret',
    async () =>
      ({
        ok: true,
        json: async () => ({ features: [{ private: 'private-address' }] }),
      } as Response),
  );
  await expect(search.search('warehouse')).rejects.toMatchObject({
    code: 'PLACE_SEARCH_INVALID_RESPONSE',
  });
});

test('reverse lookup uses the same safe access classification', async () => {
  const search = new SearchService(
    'pk.synthetic-secret',
    async () => ({ ok: false, status: 403 } as Response),
  );
  await expect(search.reverse({ lat: 40, lng: -100 })).rejects.toMatchObject({
    code: 'PLACE_SEARCH_FORBIDDEN',
  });
});
