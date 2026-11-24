import { followPosition, followPositionError } from '../src/services/copilot/FollowPosition';
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
const missing = { code: 'COPILOT_CHEVRON_UNAVAILABLE' };
test('missing marker can recover without starting navigation', async () => {
  const host = { mapCommand: jest.fn().mockRejectedValueOnce(missing).mockResolvedValue(undefined) };
  const result = followPosition(host);
  await jest.advanceTimersByTimeAsync(1000);
  await result;
  expect(host.mapCommand.mock.calls).toEqual([['recenter'], ['recenter']]);
});
test('persistent missing marker stops after three attempts', async () => {
  const host = { mapCommand: jest.fn().mockRejectedValue(missing) };
  const result = followPosition(host).catch(error => error);
  await jest.advanceTimersByTimeAsync(2000);
  expect(await result).toEqual(missing);
  expect(host.mapCommand).toHaveBeenCalledTimes(3);
});
test('permission failures and uncertain timeouts are never retried', async () => {
  for (const code of ['COPILOT_VISIBLE_PRECISE_LOCATION_REQUIRED', 'TIMEOUT']) {
    const host = { mapCommand: jest.fn().mockRejectedValue({code}) };
    await expect(followPosition(host)).rejects.toEqual({code});
    expect(host.mapCommand).toHaveBeenCalledTimes(1);
  }
  expect(followPositionError({code:'COPILOT_VISIBLE_PRECISE_LOCATION_REQUIRED'})).toContain('precise location');
});
test('unmounted preview cancels a pending recovery', async () => {
  let current = true;
  const host = { mapCommand: jest.fn().mockRejectedValue(missing) };
  const result = followPosition(host, () => current);
  await Promise.resolve();
  current = false;
  await jest.advanceTimersByTimeAsync(1000);
  await result;
  expect(host.mapCommand).toHaveBeenCalledTimes(1);
});
