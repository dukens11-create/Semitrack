import { NativeModules, Platform } from 'react-native';
import { z } from 'zod';
const stateSchema = z.object({
  muted: z.boolean(),
  volume: z.number().finite().min(0).max(1),
});
interface SpeechBridge {
  isMuted(): Promise<unknown>;
  getVolume(): Promise<unknown>;
  setMuteState(muted: boolean): Promise<void>;
  setVolume(volume: number): Promise<void>;
  playTTSMessage(
    message: string,
    delay: number,
    currentMessageOverride: boolean,
    muteOverride: boolean,
  ): Promise<void>;
}
function bridge(): SpeechBridge {
  const speech = NativeModules.SpeechMgr as SpeechBridge | undefined;
  if (Platform.OS !== 'android' || !speech)
    throw new Error('SemiTraX voice controls unavailable');
  return speech;
}
// A missing SDK callback must not leave the voice panel locked indefinitely.
// This bounds waiting only; it does not cancel or retry a native command.
async function confirmedVoice<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Voice response timed out')),
          10000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
export async function readCoPilotVoice() {
  const speech = bridge();
  const [muted, volume] = await confirmedVoice(
    Promise.all([speech.isMuted(), speech.getVolume()]),
  );
  return stateSchema.parse({ muted, volume });
}
export async function setCoPilotMute(muted: boolean) {
  await confirmedVoice(bridge().setMuteState(muted));
  return readCoPilotVoice();
}
export async function setCoPilotVolume(volume: number) {
  const valid = z.number().finite().min(0).max(1).parse(volume);
  await confirmedVoice(bridge().setVolume(valid));
  return readCoPilotVoice();
}
export async function testCoPilotVoice() {
  const state = await readCoPilotVoice();
  if (state.muted || state.volume === 0)
    throw new Error('Unmute and raise volume first');
  await confirmedVoice(
    bridge().playTTSMessage('Welcome to SemiTraX', 0, false, false),
  );
}
