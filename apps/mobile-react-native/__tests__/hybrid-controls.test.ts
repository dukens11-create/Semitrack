import {
  endHybridTrip,
  resumeHybridTrip,
  synchronizeHybridTruck,
  hybridError,
  logHybridControl,
} from '../src/services/copilot/HybridControls';
import type { Services } from '../src/app/services';
import type { CoPilotHost } from '../src/services/copilot/CoPilotHost';
import { truck } from './fixtures';
const clear = jest.fn();
const apply = jest.fn();
const services = {
  routes: { clear },
  trucks: { getSnapshot: () => ({ selected: truck }) },
} as unknown as Services;
beforeEach(() => jest.clearAllMocks());
test('resume calls native engine and propagates failure', async () => {
  const resumeEngineTrip = jest
    .fn()
    .mockRejectedValue(new Error('native failed'));
  await expect(
    resumeHybridTrip({ resumeEngineTrip } as unknown as CoPilotHost),
  ).rejects.toThrow();
  expect(resumeEngineTrip).toHaveBeenCalledTimes(1);
});
test('end retains state until native stop confirms', async () => {
  let resolve!: () => void;
  const endEngineTrip = jest.fn(
    () =>
      new Promise<void>(r => {
        resolve = r;
      }),
  );
  const pending = endHybridTrip(
    { endEngineTrip } as unknown as CoPilotHost,
    services,
  );
  expect(clear).not.toHaveBeenCalled();
  resolve();
  await pending;
  expect(clear).toHaveBeenCalledTimes(1);
});
test('failed stop does not erase planner or offline data', async () => {
  await expect(
    endHybridTrip(
      {
        endEngineTrip: async () => {
          throw new Error();
        },
      } as unknown as CoPilotHost,
      services,
    ),
  ).rejects.toThrow();
  expect(clear).not.toHaveBeenCalled();
});
test('required axle/trailer restrictions prevent partial native profile writes', async () => {
  await expect(
    synchronizeHybridTruck(services, {
      applyTruckProfile: apply,
    } as unknown as CoPilotHost),
  ).rejects.toThrow('Trailer length: this mode requires 53 feet');
  expect(apply).not.toHaveBeenCalled();
});
test('raw native errors cannot leak into driver messages', () => {
  expect(hybridError(new Error('SECRET /coords'))).not.toContain('SECRET');
  expect(hybridError({ code: 'TRUCK_RESTRICTIONS_UNREPRESENTABLE' })).toContain(
    'Trimble',
  );
});
test('control logging contains only allowed action/status', () => {
  const log = jest.spyOn(console, 'info').mockImplementation(() => {});
  logHybridControl('END_ROUTE', 'CONFIRMED');
  expect(JSON.parse(log.mock.calls[0]![0])).toEqual({
    event: 'HYBRID_CONTROL',
    action: 'END_ROUTE',
    stage: 'CONFIRMED',
  });
  log.mockRestore();
});
