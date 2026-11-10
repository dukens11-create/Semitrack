import { PoiService } from '../src/features/poi/PoiService';
import type { ApiClient } from '../src/services/api/ApiClient';
import type { TruckRoute } from '../src/models/contracts';
test('Android native POI service receives nearby and corridor requests without server substitution', async () => {
  const request = jest.fn();
  const native = {
    nearby: jest.fn().mockResolvedValue([]),
    alongRoute: jest.fn().mockResolvedValue([]),
  };
  const service = new PoiService({ request } as unknown as ApiClient, native);
  const center = { lat: 39, lng: -119 };
  await service.nearby('truck_stop', center);
  expect(native.nearby).toHaveBeenCalledWith('truck_stop', center, undefined);
  const route = {} as TruckRoute;
  const fix = {
    latitude: 39,
    longitude: -119,
    timestamp: Date.now(),
    accuracy: 5,
    heading: null,
    speed: null,
  };
  await service.alongRoute('rest_area', route, fix);
  expect(native.alongRoute).toHaveBeenCalledWith(
    'rest_area',
    route,
    fix,
    undefined,
  );
  expect(request).not.toHaveBeenCalled();
});
test('native search failure remains visible instead of presenting another provider as Trimble', async () => {
  const request = jest.fn();
  const native = {
    nearby: jest.fn().mockRejectedValue(new Error('maps unavailable')),
    alongRoute: jest.fn(),
  };
  const service = new PoiService({ request } as unknown as ApiClient, native);
  await expect(
    service.nearby('truck_stop', { lat: 39, lng: -119 }),
  ).rejects.toThrow('maps unavailable');
  expect(request).not.toHaveBeenCalled();
});
