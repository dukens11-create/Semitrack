import assert from "node:assert/strict";
import test from "node:test";
import { feetAndInches, truckDetails } from "../src/truckDetails.ts";
test("decimal API feet render as feet and inches without changing units",()=>{
  assert.equal(feetAndInches(13.5),"13 ft 6 in"); assert.equal(feetAndInches(8.5),"8 ft 6 in"); assert.equal(feetAndInches(53),"53 ft"); assert.equal(feetAndInches(12.999999),"13 ft");
});
test("missing values never become assumed vehicle facts",()=>{
  for(const value of [null,undefined,NaN,Infinity,"13.5",0,-1]) assert.equal(feetAndInches(value),"Not recorded");
  const rows=Object.fromEntries(truckDetails({isDefault:true})); assert.match(rows["Driver verification"],/Not recorded by server/); assert.match(rows["Saved default"],/not proof/); assert.equal(rows["Current weight"],"Not recorded");
});
test("all truck fields and hazmat labels retain human-readable units",()=>{
  const rows=Object.fromEntries(truckDetails({name:"Unit 004",heightFt:13.5,widthFt:8.5,lengthFt:53,weightLbs:72000,currentWeightLbs:68000,weightPerAxleLbs:34000,axleCount:5,trailerCount:1,hazardousGoods:["poisonousInhalation","harmfulToWater"]}));
  assert.equal(rows.Height,"13 ft 6 in"); assert.equal(rows["Gross routing weight"],"72,000 lb"); assert.equal(rows["Current weight"],"68,000 lb"); assert.equal(rows.Axles,"5"); assert.equal(rows.Trailers,"1"); assert.equal(rows["Hazardous goods"],"Poisonous by inhalation, Harmful to water");
  assert.equal(Object.keys(rows).length,16);
});

test('Admin displays persisted verification only for matching revision',()=>{const t={revision:3,verifiedRevision:3,verifiedAt:'2026-09-12T12:00:00Z',verificationState:'VERIFIED'};assert.equal(Object.fromEntries(truckDetails(t))['Driver verification'],'Driver verified revision 3');assert.match(Object.fromEntries(truckDetails({...t,revision:4}))['Driver verification'],/review/);assert.match(Object.fromEntries(truckDetails({...t,verificationState:'ADMIN_UPDATED'}))['Driver verification'],/Changed by operations/);});
