import {
  readCoPilotPlaces,
  setCoPilotPlaceVisible,
} from '../src/services/copilot/CoPilotPlaces';
const mockHost = { poiCatalog: jest.fn(), setPoiCategoryVisible: jest.fn() };
jest.mock('../src/services/copilot/CoPilotHost', () => ({
  coPilotHost: () => mockHost,
}));
beforeEach(() => jest.resetAllMocks());
test('returns every native category including categories unknown to SemiTraX', async () => {
  const catalog = [
    { id: 987, name: 'New provider category', visible: false },
    { id: 22, name: 'Fuel', visible: true },
  ];
  mockHost.poiCatalog.mockResolvedValue(catalog);
  expect(await readCoPilotPlaces()).toEqual(catalog);
});
test('visibility change requires provider readback', async () => {
  mockHost.setPoiCategoryVisible.mockResolvedValue([
    { id: 22, name: 'Fuel', visible: true },
  ]);
  expect(await setCoPilotPlaceVisible(22, true)).toHaveLength(1);
  expect(mockHost.setPoiCategoryVisible).toHaveBeenCalledWith(22, true);
  await expect(setCoPilotPlaceVisible(22, false)).rejects.toThrow(
    'Visibility not confirmed',
  );
});
test('invalid catalogs and native errors are surfaced', async () => {
  mockHost.poiCatalog.mockResolvedValue([{ id: 1, name: '', visible: true }]);
  await expect(readCoPilotPlaces()).rejects.toThrow();
  mockHost.poiCatalog.mockRejectedValue(new Error('not ready'));
  await expect(readCoPilotPlaces()).rejects.toThrow('not ready');
});
