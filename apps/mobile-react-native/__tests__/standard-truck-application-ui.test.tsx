import React from 'react';
import { Alert, Switch, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ApplyStandardTruck } from '../src/components/ApplyStandardTruck';
import { DriverButton } from '../src/components/DriverUI';
import type { Services } from '../src/app/services';
import { truck } from './fixtures';
const mockHost = {
  applyStandardTruckProfile: jest.fn(),
  verifyStandardTruckProfile: jest.fn(),
};
jest.mock('../src/services/copilot/CoPilotHost', () => ({
  coPilotHost: () => mockHost,
}));
jest.mock('../src/hooks/useStore', () => ({
  useStore: (store: { getSnapshot: () => unknown }) => store.getSnapshot(),
}));
const selected = {
  ...truck,
  lengthFt: 53,
  currentWeightLbs: null,
  hazmatEnabled: false,
  hazardousGoods: [],
  avoidFerries: false,
  avoidResidential: false,
  avoidDirtRoads: false,
};
const services = {
  trucks: { getSnapshot: () => ({ selected }) },
} as unknown as Services;
test('cancel leaves native untouched; reviewed actual overall length is applied only after confirmation', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ApplyStandardTruck
        services={services}
        disabled={false}
        run={async action => {
          await action();
        }}
      />,
    );
  });
  const press = async (title: string) => {
    await act(async () => {
      tree.root
        .findAllByType(DriverButton)
        .find(x => x.props.title === title)!
        .props.onPress();
    });
  };
  await press('Apply saved truck to CoPilot');
  expect(tree.root.findAllByType(TextInput)[0]!.props.value).toBe('');
  expect(
    tree.root
      .findAllByType(DriverButton)
      .find(x => x.props.title === 'Review and apply truck')!.props.disabled,
  ).toBe(true);
  await act(async () => {
    tree.root.findAllByType(TextInput)[0]!.props.onChangeText('73');
    tree.root.findByType(Switch).props.onValueChange(true);
  });
  await press('Review and apply truck');
  expect(alert.mock.calls[0]![1]).toContain('Total routing weight: 80,000 lb');
  expect(alert.mock.calls[0]![1]).toContain('Overall length: 73 ft 0 in');
  expect(alert.mock.calls[0]![2]![0]!.text).toBe('Cancel');
  expect(mockHost.applyStandardTruckProfile).not.toHaveBeenCalled();
  await act(async () => {
    alert.mock.calls[0]![2]![1]!.onPress!();
  });
  expect(mockHost.applyStandardTruckProfile).toHaveBeenCalledWith(
    expect.objectContaining({
      bumperToBumperLengthInches: 876,
      weightLbs: 80000,
      weightPerAxleLbs: 17000,
    }),
  );
  expect(mockHost.verifyStandardTruckProfile).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
  alert.mockRestore();
});
