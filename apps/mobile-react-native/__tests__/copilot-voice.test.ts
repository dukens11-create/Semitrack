import { NativeModules, Platform } from 'react-native';
import {
  readCoPilotVoice,
  setCoPilotMute,
  testCoPilotVoice,
} from '../src/services/copilot/CoPilotVoice';
beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(Platform, 'OS', {
    value: 'android',
    configurable: true,
  });
  NativeModules.SpeechMgr = {
    isMuted: jest.fn().mockResolvedValue(false),
    getVolume: jest.fn().mockResolvedValue(0.5),
    setMuteState: jest.fn().mockResolvedValue(undefined),
    playTTSMessage: jest.fn().mockResolvedValue(undefined),
  };
});
afterEach(() => {
  jest.useRealTimers();
  delete NativeModules.SpeechMgr;
});
test('missing voice read callback rejects instead of hanging', async () => {
  NativeModules.SpeechMgr.getVolume.mockReturnValue(new Promise(() => {}));
  const pending = readCoPilotVoice().catch(error => error);
  await jest.advanceTimersByTimeAsync(10000);
  expect(await pending).toEqual(new Error('Voice response timed out'));
});
test('missing write callback times out without retrying the native command', async () => {
  NativeModules.SpeechMgr.setMuteState.mockReturnValue(new Promise(() => {}));
  const pending = setCoPilotMute(true).catch(error => error);
  await jest.advanceTimersByTimeAsync(10000);
  expect(await pending).toEqual(new Error('Voice response timed out'));
  expect(NativeModules.SpeechMgr.setMuteState).toHaveBeenCalledTimes(1);
});
test('muted audio does not play or override the mute setting', async () => {
  NativeModules.SpeechMgr.isMuted.mockResolvedValue(true);
  await expect(testCoPilotVoice()).rejects.toThrow('Unmute');
  expect(NativeModules.SpeechMgr.playTTSMessage).not.toHaveBeenCalled();
});
test('successful read clears its timeout', async () => {
  await expect(readCoPilotVoice()).resolves.toEqual({
    muted: false,
    volume: 0.5,
  });
  expect(jest.getTimerCount()).toBe(0);
});

test('mute rejects unchanged SDK readback without retrying or forcing audio', async () => {
  await expect(setCoPilotMute(true)).rejects.toThrow('not confirmed');
  expect(NativeModules.SpeechMgr.setMuteState).toHaveBeenCalledTimes(1);
  expect(NativeModules.SpeechMgr.playTTSMessage).not.toHaveBeenCalled();
});
test('mute accepts matching SDK readback', async () => {
  NativeModules.SpeechMgr.isMuted.mockResolvedValue(true);
  await expect(setCoPilotMute(true)).resolves.toMatchObject({ muted: true });
});
test('unmute rejects a still-muted SDK readback', async () => {
  NativeModules.SpeechMgr.isMuted.mockResolvedValue(true);
  await expect(setCoPilotMute(false)).rejects.toThrow('not confirmed');
});
test('voice test preserves current speech and respects mute override', async () => {
  await testCoPilotVoice();
  expect(NativeModules.SpeechMgr.playTTSMessage).toHaveBeenCalledWith('Welcome to SemiTraX', 0, false, false);
});
