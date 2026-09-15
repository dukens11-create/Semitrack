import test from 'node:test';
import assert from 'node:assert/strict';
import {routingCapabilities,recordRoutingOutcome} from '../dist/services/routingCapabilities.js';
const now=new Date('2026-09-15T12:00:00Z');
test('configuration alone never reports operational or a license failure',()=>{
 recordRoutingOutcome(null,0);
 const missing=routingCapabilities(false,[],now);assert.equal(missing.truckRouting.state,'PROVIDER_MISCONFIGURED');assert.equal(missing.truckRouting.requestAllowed,false);
 const configured=routingCapabilities(true,[],now);assert.equal(configured.truckRouting.state,'PLANNING_UNVERIFIED');assert.equal(configured.truckRouting.status,'DEGRADED');assert.equal(configured.turnByTurn.licenseStatus,'UNVERIFIED');assert.equal(configured.turnByTurn.available,false);
});
test('actual routing evidence expires and distinguishes authorization from outages',()=>{
 recordRoutingOutcome(null,now.getTime());assert.equal(routingCapabilities(true,[],now).truckRouting.state,'PLANNING_AVAILABLE');
 assert.equal(routingCapabilities(true,[],new Date(now.getTime()+300000)).truckRouting.state,'PLANNING_UNVERIFIED');
 recordRoutingOutcome('TRIMBLE_AUTHORIZATION_FAILED',now.getTime());assert.equal(routingCapabilities(true,[],now).truckRouting.state,'PROVIDER_MISCONFIGURED');
 recordRoutingOutcome('TRIMBLE_NETWORK_ERROR',now.getTime());assert.equal(routingCapabilities(true,[],now).truckRouting.state,'PROVIDER_UNAVAILABLE');
 recordRoutingOutcome(null,0);
});
