# Step 6 — Voice navigation and speaker output

Status: Partially Fixed.

Root cause: setCoPilotMute awaited the native setter and read settings, but accepted a returned mute state that disagreed with the requested state.

Correction: require matching native mute readback, otherwise surface an unconfirmed command. No retries, audio-stream switching, forced unmute or guidance substitution were added. Existing ten-second command/read deadlines remain.

Files changed:
- apps/mobile-react-native/src/services/copilot/CoPilotVoice.ts
- apps/mobile-react-native/__tests__/copilot-voice.test.ts
- docs/verification/step-06-voice-readback.md

Tests: 72 suites / 1,000 tests passed; TypeScript typecheck passed. New regressions cover rejected mute, accepted mute, rejected unmute, and test speech preserving current-message/mute overrides. These use a bridge mock and do not certify physical output.

Android verification: pending. The installed vendor SpeechMgr bridge owns playback. Verify SDK voice data, audible turn instructions, speaker, supported Bluetooth/vehicle output, audio focus, disconnect/reconnect, mute/volume readback and foreground/background guidance on a licensed device. No local vendor bridge package or connected device is available. Do not replace native audio routing with guessed SDK methods.

Branch: codex/step-06-voice-readback, stacked on codex/step-05-gps-recovery.
Next: Step 7 — rerouting and missed turns.
Release instruction: finish repair work before starting another APK build. No build is triggered by this draft branch.
