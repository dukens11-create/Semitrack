import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import { ServicesScreen } from '../src/screens/ServicesScreen';
import { Button } from '../src/components/ui';
import { Store } from '../src/state/Store';
import type { Services } from '../src/app/services';
import { route, deferred } from './fixtures';
class Routes extends Store<{ route: ReturnType<typeof route> | null }> {
  change() {
    this.publish({ route: null });
  }
}
test('Route change cancels corridor request and discards delayed provider record', async () => {
  const routes = new Routes({ route: route() }),
    wait = deferred<Record<string, unknown>[]>();
  const corridor = jest.fn(() => wait.promise);
  const services = {
    routes,
    poi: { corridor },
    location: {
      getFreshFix: () => ({
        latitude: 40,
        longitude: -120,
        accuracy: 4,
        timestamp: Date.now(),
      }),
    },
  } as unknown as Services;
  let screen!: ReactTestRenderer;
  await act(async () => {
    screen = create(<ServicesScreen services={services} />);
  });
  await act(async () =>
    screen.root
      .findAllByType(Button)
      .find(b => b.props.title === 'road events')!
      .props.onPress(),
  );
  expect(corridor).toHaveBeenCalledTimes(1);
  await act(async () => routes.change());
  await act(async () => wait.resolve([{ title: 'Late stale event' }]));
  expect(
    screen.root
      .findAllByType(Text)
      .map(n => n.props.children)
      .join(' '),
  ).not.toContain('Late stale event');
  await act(async () => screen.unmount());
});
test('Provider/offline failure is actionable and never presented as clear roads', async () => {
  const routes = new Routes({ route: route() });
  const services = {
    routes,
    poi: {
      corridor: jest.fn().mockRejectedValue(new Error('network unavailable')),
    },
    location: {
      getFreshFix: () => ({
        latitude: 40,
        longitude: -120,
        accuracy: 4,
        timestamp: Date.now(),
      }),
    },
  } as unknown as Services;
  let screen!: ReactTestRenderer;
  await act(async () => {
    screen = create(<ServicesScreen services={services} />);
  });
  await act(async () =>
    screen.root
      .findAllByType(Button)
      .find(b => b.props.title === 'road events')!
      .props.onPress(),
  );
  const alerts = screen.root
    .findAllByType(Text)
    .filter(n => n.props.accessibilityRole === 'alert');
  expect(alerts.length).toBeGreaterThan(0);
  expect(
    screen.root
      .findAllByType(Text)
      .map(n => n.props.children)
      .join(' '),
  ).not.toContain('No provider records returned');
  await act(async () => screen.unmount());
});

import { ApiError } from '../src/services/api/ApiClient';
test.each(['CORRIDOR_ROUTE_REQUIRED','CORRIDOR_LOCATION_REQUIRED','CORRIDOR_LOCATION_INVALID','CORRIDOR_LOCATION_STALE','CORRIDOR_LOCATION_OFF_ROUTE','CORRIDOR_LOCATION_AMBIGUOUS','CORRIDOR_CORRELATION_FAILED'])('ServicesScreen displays %s as an error, never an empty corridor success',async code=>{
 const routes=new Routes({route:route()});
 const services={routes,poi:{corridor:jest.fn().mockRejectedValue(new ApiError(code,'untrusted server detail',422))},location:{getFreshFix:()=>({latitude:40,longitude:-120,accuracy:4,timestamp:Date.now()})}} as unknown as Services;
 let screen!:ReactTestRenderer;
 await act(async()=>{screen=create(<ServicesScreen services={services}/>);});
 await act(async()=>screen.root.findAllByType(Button).find(b=>b.props.title==='road events')!.props.onPress());
 expect(screen.root.findAllByType(Text).some(n=>n.props.accessibilityRole==='alert')).toBe(true);
 const content=screen.root.findAllByType(Text).map(n=>n.props.children).join(' ');
 expect(content).not.toContain('No provider records returned');expect(content).not.toContain('untrusted server detail');
 await act(async()=>screen.unmount());
});
