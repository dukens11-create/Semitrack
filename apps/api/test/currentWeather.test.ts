import assert from 'node:assert/strict';
import test from 'node:test';
import { getCurrentWeather } from '../dist/services/weatherService.js';
import { env } from '../dist/config/env.js';

test('current weather accepts a fresh location without any route', async t => {
  const key = env.openWeatherApiKey;
  env.openWeatherApiKey = 'synthetic-test';
  const now = Date.now();
  const fetch = t.mock.method(globalThis, 'fetch', async () => ({ok:true, json:async()=>({
    coord:{lat:40,lon:-120}, dt:Math.floor(now/1000), main:{temp:68}, weather:[{main:'Clear',description:'clear sky'}],
  })}));
  try {
    const result = await getCurrentWeather({lat:40,lng:-120,accuracy:5,timestamp:now}, now);
    assert.equal(result.status, 'AREA_OBSERVATION');
    assert.equal(result.tempF, 68);
    assert.equal(fetch.mock.callCount(), 1);
  } finally { env.openWeatherApiKey = key; }
});
test('stale current location does not contact the provider', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => {throw Error('unexpected');});
  const now = Date.now();
  const result = await getCurrentWeather({lat:40,lng:-120,accuracy:5,timestamp:now-16000},now);
  assert.equal(result.status,'UNAVAILABLE');
  assert.equal(fetch.mock.callCount(),0);
});
test('invalid coordinates fail validation and missing weather key stays unavailable', async () => {
  await assert.rejects(()=>getCurrentWeather({lat:91,lng:0,accuracy:5,timestamp:Date.now()}));
  const key=env.openWeatherApiKey;
  env.openWeatherApiKey='';
  try { assert.equal((await getCurrentWeather({lat:40,lng:-120,accuracy:5,timestamp:Date.now()})).status,'UNAVAILABLE'); }
  finally {env.openWeatherApiKey=key;}
});
