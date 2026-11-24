import assert from 'node:assert/strict';
import test from 'node:test';
import { applyStandardRoutingPreset } from '../dist/modules/trucks/standardRoutingPreset.js';
const truck = {name:'Test',tractorType:'Sleeper Cab',trailerType:'Dry Van',trailerCount:1,
 heightFt:13.5,widthFt:8.5,lengthFt:53,weightLbs:80000,currentWeightLbs:76000,
 weightPerAxleLbs:null,axleCount:5,hazmatEnabled:false,hazardousGoods:[],
 avoidTolls:true,avoidFerries:false,avoidHighways:false,avoidResidential:false,avoidDirtRoads:false};
const preset = 'STANDARD_SINGLE_53_AXLE_34000';
test('an explicitly accepted standard preset affects routing only, not saved measurements',()=>{
 const saved=structuredClone(truck);
 const result=applyStandardRoutingPreset(saved,preset);
 assert.equal(result.weightPerAxleLbs,34000);
 assert.equal(result.weightLbs,80000);
 assert.equal(result.currentWeightLbs,76000);
 assert.deepEqual(saved,truck);
});
test('missing acceptance never supplies a default',()=>{
 assert.equal(applyStandardRoutingPreset(truck).weightPerAxleLbs,null);
 assert.equal(applyStandardRoutingPreset({...truck,weightPerAxleLbs:25000}).weightPerAxleLbs,25000);
});
for(const change of [{weightPerAxleLbs:35000},{weightPerAxleLbs:25000},{lengthFt:48},{trailerCount:2},
 {axleCount:4},{tractorType:'Box truck'},{trailerType:'Flatbed'},{heightFt:14},{widthFt:9},
 {weightLbs:90000},{hazmatEnabled:true,hazardousGoods:['flammable']},
 {avoidHighways:true},{avoidFerries:true},{avoidResidential:true},{avoidDirtRoads:true}]) {
 test(`preset rejects incompatible profile ${JSON.stringify(change)}`,()=>{
  assert.throws(()=>applyStandardRoutingPreset({...truck,...change},preset));
 });
}
test('unknown preset is rejected',()=>assert.throws(()=>applyStandardRoutingPreset(truck,'unknown')));
