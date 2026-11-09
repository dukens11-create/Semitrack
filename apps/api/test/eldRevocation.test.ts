import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { revokeProviderToken } from '../dist/services/eldService.js';

test('ELD revocation never forwards the refresh token through an HTTP redirect', async () => {
  let redirectedRequests = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    if (req.url === '/revoke') {
      res.writeHead(307, { Location: '/unexpected-target' });
    } else {
      redirectedRequests++;
      res.writeHead(200);
    }
    res.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, init) => originalFetch(`http://127.0.0.1:${address.port}/revoke`, init);
  try {
    await assert.rejects(revokeProviderToken('SAMSARA', 'synthetic-refresh-token'));
    assert.equal(redirectedRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('ELD revocation errors omit provider response bodies and tokens', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('synthetic-private-provider-message', { status: 503 });
  try {
    await assert.rejects(revokeProviderToken('SAMSARA', 'synthetic-refresh-token'), {
      message: 'SAMSARA token revocation failed (503)',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unsupported revocation performs no provider request', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Unexpected provider call'); };
  try {
    assert.equal(await revokeProviderToken('MOTIVE', 'synthetic-refresh-token'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
