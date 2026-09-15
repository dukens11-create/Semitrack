import {
  LocationService,
  type LocationProvider,
} from '../src/services/location/LocationService';
test('real stationary GPS samples keep a fix fresh; stopping samples still expires it', async () => {
  jest.useFakeTimers();
  let emit: (fix: unknown) => void = () => {};
  const provider: LocationProvider = {
    permissionStatus: async () => 'granted',
    permission: async () => 'granted',
    start: async () => {},
    stop: async () => {},
    subscribe: callback => {
      emit = callback;
      return () => {};
    },
  };
  const location = new LocationService(provider);
  try {
    await location.startIfPermitted();
    for (let second = 0; second < 60; second++) {
      emit({
        latitude: 40,
        longitude: -100,
        accuracy: 4,
        timestamp: Date.now(),
        heading: null,
        speed: 0,
      });
      jest.advanceTimersByTime(1000);
      expect(location.getSnapshot().fix).not.toBeNull();
    }
    jest.advanceTimersByTime(20000);
    expect(location.getSnapshot().fix).toBeNull();
  } finally {
    await location.stop();
    jest.useRealTimers();
  }
});
