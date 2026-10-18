import { NativeModules, Platform } from 'react-native';
import { readActiveTruckProfile, profileEnumLabel } from '../src/services/copilot/ActiveTruckProfile';
const profile = {name: 'Duke', vehicleType: 7, dims: {height:162,width:102,length:636,totalWeight:80000,weightPerAxle:17000}};
beforeEach(() => {
  Object.defineProperty(Platform, 'OS', {configurable:true,value:'android'});
  NativeModules.VehicleType = {TRUCK_HEAVY_DUTY:7};
  NativeModules.RouteMgr = {getActiveVehicleRoutingProfile: jest.fn(async () => profile)};
});
test('reads actual selected heavy truck without mutating engine', async () => {
  expect(await readActiveTruckProfile()).toEqual(profile);
});
test('rejects passenger profiles and invalid dimensions', async () => {
  NativeModules.RouteMgr.getActiveVehicleRoutingProfile.mockResolvedValueOnce({...profile,vehicleType:0});
  await expect(readActiveTruckProfile()).rejects.toThrow();
  NativeModules.RouteMgr.getActiveVehicleRoutingProfile.mockResolvedValueOnce({...profile,dims:{...profile.dims,height:0}});
  await expect(readActiveTruckProfile()).rejects.toThrow();
});
test('does not guess enum values or claim absent preferences', () => {
  NativeModules.TollRoads = {ALWAYS_AVOID:8};
  expect(profileEnumLabel('TollRoads',8)).toBe('always avoid');
  expect(profileEnumLabel('TollRoads',3)).toBe('Unknown setting');
  expect(profileEnumLabel('TollRoads',undefined)).toBe('Not supplied');
});
