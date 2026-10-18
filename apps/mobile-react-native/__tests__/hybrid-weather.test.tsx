import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {WeatherStatus} from '../src/features/weather/WeatherStatus';
import {Store} from '../src/state/Store';
import type {Services} from '../src/app/services';
import {deferred} from './fixtures';
let tree:ReactTestRenderer;
const fix={latitude:40,longitude:-120,timestamp:Date.now(),accuracy:5,speed:0,heading:0};
const observation={status:'AREA_OBSERVATION',tempF:68,condition:'Clear',provider:'Test',providerPoint:{lat:40,lng:-120},observedAt:new Date().toISOString()};
const currentWeather=jest.fn();
const getFreshFix=jest.fn();
const services={settings:new Store({settings:null}),location:{getFreshFix},poi:{currentWeather}} as unknown as Services;
const text=()=>JSON.stringify(tree.toJSON());
beforeEach(()=>{jest.clearAllMocks();getFreshFix.mockReturnValue(fix);});
afterEach(async()=>{if(tree)await act(async()=>tree.unmount());});
async function render(location=fix){await act(async()=>{tree=create(<WeatherStatus services={services} route={null} fix={location} driving/>);});}
test('automatically loads real current weather without a route and keeps driving badge visible',async()=>{
 const pending=deferred<Record<string,unknown>>();currentWeather.mockReturnValue(pending.promise);
 await render();expect(text()).toContain('loading');expect(currentWeather).toHaveBeenCalledTimes(1);
 await act(async()=>pending.resolve(observation));expect(text()).toContain('68°F');expect(text()).toContain('Current driving weather details');
});
test('network failure displays connection error without an invented temperature',async()=>{
 currentWeather.mockRejectedValue(new Error('offline'));await render();expect(text()).toContain('connection error');expect(text()).not.toContain('68°F');
});
test('no fresh permission-qualified location means no provider call',async()=>{
 getFreshFix.mockReturnValue(null);await render();expect(currentWeather).not.toHaveBeenCalled();expect(text()).toContain('unavailable');
});
test('missing provider is unavailable and stale observations are labelled stale',async()=>{
 currentWeather.mockResolvedValue({status:'UNAVAILABLE',reasonCode:'WEATHER_PROVIDER_NOT_CONFIGURED'});await render();expect(text()).toContain('unavailable');
 await act(async()=>tree.unmount());
 currentWeather.mockResolvedValue({...observation,observedAt:new Date(Date.now()-3*3600000).toISOString()});await render();expect(text()).toContain('stale');expect(text()).not.toContain('68°F');
});
