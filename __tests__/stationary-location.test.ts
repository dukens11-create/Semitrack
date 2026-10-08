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

test('implausible GPS jump is rejected without manufacturing motion or freezing later valid fixes', async () => {
  let emit: (value: unknown) => void = () => {};
  const provider: LocationProvider = {
    permissionStatus: async () => 'granted',
    permission: async () => 'granted',
    start: async () => {},
    stop: async () => {},
    subscribe: cb => {
      emit = cb;
      return () => {};
    },
  };
  const service = new LocationService(provider);
  await service.startIfPermitted();
  const now = Date.now();
  const fix = {
    latitude: 40,
    longitude: -100,
    accuracy: 5,
    timestamp: now,
    heading: 360,
    speed: 0,
  };
  try {
    emit(fix);
    expect(service.getSnapshot().fix?.heading).toBe(0);
    emit({ ...fix, latitude: 41, timestamp: now + 1000 });
    expect(service.getSnapshot().fix?.latitude).toBe(40);
    emit({ ...fix, latitude: 40.0001, timestamp: now + 2000 });
    expect(service.getSnapshot().fix?.latitude).toBe(40.0001);
  } finally {
    await service.stop();
  }
});
