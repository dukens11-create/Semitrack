import test from "node:test";
import assert from "node:assert/strict";
import { truckSchema, truckUpdateSchema, routingTruckSchema } from "../src/modules/trucks/truck.schemas.ts";
const truck={name:"Unit test truck",heightFt:13.5,widthFt:8.5,lengthFt:53,weightLbs:80000,currentWeightLbs:76000,weightPerAxleLbs:34000,axleCount:5,trailerCount:1};
test("API dimensions are decimal feet, with no inches fields",()=>{
 const value=truckSchema.parse(truck);assert.equal(value.heightFt,13.5);assert.equal(value.widthFt,8.5);assert.equal(value.lengthFt,53);assert.equal(value.weightLbs,80000);
 assert.equal(truckSchema.safeParse({...truck,heightFt:162}).success,false);
 assert.equal(truckSchema.safeParse({...truck,heightFt:20}).success,true);
 assert.equal(truckSchema.safeParse({...truck,heightFt:20.01}).success,false);
});
test("partial profile updates revalidate relationships after merge",()=>{
 const partial=truckUpdateSchema.parse({weightLbs:70000});assert.equal(truckSchema.safeParse({...truck,...partial}).success,false);
 assert.equal(routingTruckSchema.safeParse({...truck,weightLbs:70000}).success,false);
 assert.equal(routingTruckSchema.safeParse({...truck,hazmatEnabled:true,hazardousGoods:[]}).success,false);
});
test("backend counts and optional weights stay in declared units",()=>{
 for(const changes of [{axleCount:1},{axleCount:5.5},{trailerCount:5},{trailerCount:1.5},{weightLbs:80000.5},{lengthFt:151},{weightPerAxleLbs:499}])assert.equal(truckSchema.safeParse({...truck,...changes}).success,false);
 const value=truckSchema.parse({...truck,currentWeightLbs:null,weightPerAxleLbs:null,trailerCount:0});assert.equal(value.currentWeightLbs,null);assert.equal(value.trailerCount,0);
});
