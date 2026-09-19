/** Only fixed event codes and scalar status metadata are accepted. No messages, URLs or payloads. */
export type DiagnosticEvent = 'RENDER_FAILED' | 'NATIVE_CALLBACK_INVALID' | 'LOCAL_SIGNOUT_ONLY' | 'GUIDANCE_STOP_FAILED';
export function safeLog(event: DiagnosticEvent, status?: number) {
  if (!__DEV__) return;
  console.warn(JSON.stringify({ event, ...(Number.isInteger(status) && status! >= 100 && status! <= 599 ? { status } : {}) }));
}
