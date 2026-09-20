import { AppState } from 'react-native';
import { DriverError } from '../../errors/driverErrors';

/** A transient native lifecycle state must not silently discard a confirmed route.
 * Never dispatch in the background or assume an unknown state is foreground. */
export function waitForRouteForeground(signal: AbortSignal): Promise<void> {
  if (signal.aborted)
    return Promise.reject(new DriverError('REQUEST_CANCELLED'));
  if (AppState.currentState === 'active') return Promise.resolve();
  if (AppState.currentState === 'background')
    return Promise.reject(new DriverError('ROUTE_APP_NOT_ACTIVE'));
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error?: DriverError) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      subscription.remove();
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(new DriverError('REQUEST_CANCELLED'));
    const check = () => {
      if (signal.aborted) abort();
      else if (AppState.currentState === 'active') finish();
      else if (AppState.currentState === 'background')
        finish(new DriverError('ROUTE_APP_NOT_ACTIVE'));
    };
    const timer = setTimeout(
      () => finish(new DriverError('ROUTE_APP_NOT_ACTIVE')),
      3000,
    );
    const subscription = AppState.addEventListener('change', check);
    signal.addEventListener('abort', abort, { once: true });
    check();
  });
}
