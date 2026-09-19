import { AuthStore } from '../src/features/auth/AuthStore';
import { ApiClient } from '../src/services/api/ApiClient';
import { SerializedTokenVault } from '../src/services/storage/SerializedTokenVault';
import { MemoryVault, reply, tokens, user, deferred } from './fixtures';
test('registration and login save validated credentials and authenticated user', async () => {
  const vault = new MemoryVault();
  const transport = jest.fn(async () => reply({ ...tokens, user }));
  const auth = new AuthStore(
    new ApiClient('https://api.example.test', vault, transport),
    vault,
  );
  await auth.authenticate(user.email, 'test-password', user.fullName);
  expect(auth.getSnapshot().status).toBe('signedIn');
  expect(vault.value).toEqual(tokens);
});
test('invalid auth response never saves tokens', async () => {
  const vault = new MemoryVault();
  const auth = new AuthStore(
    new ApiClient(
      'https://api.example.test',
      vault,
      jest.fn(async () => reply({ accessToken: 'x' })),
    ),
    vault,
  );
  await expect(
    auth.authenticate(user.email, 'test-password'),
  ).rejects.toThrow();
  expect(vault.value).toBeNull();
});
test('offline restore retains session; retry succeeds', async () => {
  const vault = new MemoryVault(tokens);
  const transport = jest
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(reply(user));
  const auth = new AuthStore(
    new ApiClient('https://api.example.test', vault, transport),
    vault,
  );
  await auth.restore();
  expect(auth.getSnapshot().status).toBe('unavailable');
  expect(vault.value).toEqual(tokens);
  await auth.restore();
  expect(auth.getSnapshot().user).toEqual(user);
});
test('expired refresh signs out and clears storage', async () => {
  const vault = new MemoryVault(tokens);
  const api = new ApiClient(
    'https://api.example.test',
    vault,
    jest.fn(async () => reply({ error: { message: 'Unauthorized' } }, 401)),
  );
  const auth = new AuthStore(api, vault);
  await auth.restore();
  expect(vault.value).toBeNull();
  expect(auth.getSnapshot().status).toBe('signedOut');
});
test('transient refresh failure retains tokens', async () => {
  const vault = new MemoryVault(tokens);
  const transport = jest
    .fn()
    .mockResolvedValueOnce(reply({}, 401))
    .mockResolvedValueOnce(reply({}, 503));
  const auth = new AuthStore(
    new ApiClient('https://api.example.test', vault, transport),
    vault,
  );
  await auth.restore();
  expect(vault.value).toEqual(tokens);
  expect(auth.getSnapshot().status).toBe('unavailable');
});
test('concurrent 401 responses rotate tokens only once', async () => {
  const vault = new MemoryVault(tokens);
  let refreshes = 0;
  const transport = jest.fn(async (url, options) => {
    if (String(url).endsWith('/auth/refresh')) {
      refreshes++;
      return reply({
        accessToken: 'new-test-access',
        refreshToken: 'new-test-refresh',
      });
    }
    return (options?.headers as Record<string, string>).Authorization ===
      'Bearer new-test-access'
      ? reply(user)
      : reply({}, 401);
  }) as jest.MockedFunction<typeof fetch>;
  const api = new ApiClient('https://api.example.test', vault, transport);
  await Promise.all([api.request('GET', '/me'), api.request('GET', '/me')]);
  expect(refreshes).toBe(1);
  expect(vault.value?.accessToken).toBe('new-test-access');
});
test('late login cannot resurrect logged-out session', async () => {
  const pending = deferred<Response>();
  const vault = new SerializedTokenVault(new MemoryVault());
  const api = new ApiClient(
    'https://api.example.test',
    vault,
    jest.fn(() => pending.promise),
  );
  const auth = new AuthStore(api, vault);
  const login = auth.authenticate(user.email, 'test-password');
  await auth.logout();
  pending.resolve(reply({ ...tokens, user }));
  await login;
  expect(await vault.read()).toBeNull();
  expect(auth.getSnapshot().status).toBe('signedOut');
});
test('offline logout clears local session without refresh', async () => {
  const vault = new MemoryVault(tokens);
  const transport = jest.fn(async () => {
    throw new Error('offline');
  });
  const auth = new AuthStore(
    new ApiClient('https://api.example.test', vault, transport),
    vault,
  );
  await auth.logout();
  expect(vault.value).toBeNull();
  expect(auth.getSnapshot().status).toBe('signedOut');
  expect(transport).toHaveBeenCalledTimes(1);
});
test('secure writes are ordered before logout clear', async () => {
  const pending = deferred<void>();
  const memory = new MemoryVault();
  const slow = {
    read: () => memory.read(),
    write: async () => {
      await pending.promise;
      await memory.write(tokens);
    },
    clear: () => memory.clear(),
  };
  const vault = new SerializedTokenVault(slow);
  const write = vault.write(tokens);
  const clear = vault.clear();
  pending.resolve();
  await Promise.all([write, clear]);
  expect(await vault.read()).toBeNull();
});

test('password recovery uses the public existing endpoint without changing the session', async () => {
  const vault = new MemoryVault(tokens);
  const transport = jest.fn(async () => reply({ accepted: true }, 202));
  const auth = new AuthStore(
    new ApiClient('https://api.example.test', vault, transport),
    vault,
  );
  const before = auth.getSnapshot();
  await auth.requestPasswordReset(' driver@example.test ');
  expect(transport).toHaveBeenCalledWith(
    'https://api.example.test/auth/password-reset/request',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'driver@example.test' }),
    }),
  );
  expect(transport.mock.calls[0]).toBeDefined();
  const options = (
    transport.mock.calls as unknown as Array<[string, RequestInit]>
  )[0]![1];
  expect(options.headers).not.toHaveProperty('Authorization');
  expect(vault.value).toEqual(tokens);
  expect(auth.getSnapshot()).toEqual(before);
});
