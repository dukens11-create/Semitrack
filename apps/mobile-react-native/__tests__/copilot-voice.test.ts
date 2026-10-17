import { NativeModules, Platform } from 'react-native';
import {
  readCoPilotVoice,
  setCoPilotMute,
  setCoPilotVolume,
  testCoPilotVoice,
} from '../src/services/copilot/CoPilotVoice';
const speech = {
  isMuted: jest.fn(),
  getVolume: jest.fn(),
  setMuteState: jest.fn(),
  setVolume: jest.fn(),
  playTTSMessage: jest.fn(),
};
beforeEach(() => {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: 'android',
  });
  NativeModules.SpeechMgr = speech;
  jest.resetAllMocks();
  speech.isMuted.mockResolvedValue(false);
  speech.getVolume.mockResolvedValue(0.5);
});
test('reads SemiTraX state and reads back mute changes', async () => {
  expect(await readCoPilotVoice()).toEqual({ muted: false, volume: 0.5 });
  speech.isMuted.mockResolvedValue(true);
  expect(await setCoPilotMute(true)).toEqual({ muted: true, volume: 0.5 });
  expect(speech.setMuteState).toHaveBeenCalledWith(true);
});
test('volume validates range and returns native readback', async () => {
  await expect(setCoPilotVolume(2)).rejects.toThrow();
  expect(speech.setVolume).not.toHaveBeenCalled();
  speech.getVolume.mockResolvedValue(0.6);
  expect(await setCoPilotVolume(0.6)).toEqual({ muted: false, volume: 0.6 });
  expect(speech.setVolume).toHaveBeenCalledWith(0.6);
});
test('test sample respects mute and zero volume', async () => {
  speech.isMuted.mockResolvedValue(true);
  await expect(testCoPilotVoice()).rejects.toThrow();
  speech.isMuted.mockResolvedValue(false);
  speech.getVolume.mockResolvedValue(0);
  await expect(testCoPilotVoice()).rejects.toThrow();
  expect(speech.playTTSMessage).not.toHaveBeenCalled();
  speech.getVolume.mockResolvedValue(0.5);
  await testCoPilotVoice();
  expect(speech.playTTSMessage).toHaveBeenCalledWith('Welcome to SemiTraX', 0, false, false);
});
test('native failures and invalid readbacks cannot claim success', async () => {
  speech.setMuteState.mockRejectedValue(new Error('not ready'));
  await expect(setCoPilotMute(true)).rejects.toThrow('not ready');
  speech.getVolume.mockResolvedValue(NaN);
  await expect(readCoPilotVoice()).rejects.toThrow();
});
