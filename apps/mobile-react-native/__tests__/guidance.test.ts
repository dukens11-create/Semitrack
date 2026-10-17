import {
  UnavailableNavigationEngine,
  GUIDANCE_UNAVAILABLE,
} from '../src/services/guidance/NavigationEngine';
import { NativeGuidanceAdapter } from '../src/native/navigation/NativeGuidanceAdapter';
import { createStopPlan } from '../src/features/stops/StopPlan';
import { truck, route } from './fixtures';
jest.mock('../src/native/navigation/NativeSemiTraxPlatform', () => ({
  __esModule: true,
  default: { guidanceCommand: jest.fn(async () => 'unexpected-success') },
}));
test('every guidance operation fails closed without emitting started or arrival', async () => {
  const engine = new UnavailableNavigationEngine();
  const events = jest.fn();
  engine.subscribe(events);
  const stop = { id: 'destination', name: 'Delivery', lat: 40, lng: -100 };
  const plan = createStopPlan(stop);
  expect(await engine.initialize()).toEqual({
    available: false,
    code: GUIDANCE_UNAVAILABLE,
  });
  for (const action of [
    () => engine.setTruckProfile(truck),
    () => engine.setRoute(route(), plan),
    () => engine.startNavigation(),
    () => engine.pauseNavigation(),
    () => engine.resumeNavigation(),
    () => engine.addStop(stop),
    () => engine.removeStop(stop.id),
    () => engine.reroute(route(), plan),
  ]) {
    await expect(action()).rejects.toMatchObject({
      code: GUIDANCE_UNAVAILABLE,
    });
  }
  await engine.stopNavigation();
  expect(events).not.toHaveBeenCalled();
  expect(engine.getNavigationState().phase).toBe('unavailable');
});
test('unexpected native success still cannot enable JS guidance', async () => {
  const adapter = new NativeGuidanceAdapter();
  await expect(adapter.startNavigation()).rejects.toMatchObject({
    code: GUIDANCE_UNAVAILABLE,
  });
  expect(adapter.getNavigationState().phase).toBe('unavailable');
});
