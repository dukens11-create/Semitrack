import test from 'node:test';
import assert from 'node:assert/strict';
import {canSuspendForPayment,canRestorePaidAccess,pricingValuesSchema,holdUpdateSchema} from '../dist/modules/billing/subscriptionControls.js';
import {isEntitlementSourceActive,entitlementSourceEnd,entitlementCacheDeadline} from '../dist/modules/billing/billingPolicy.js';
import {defaultSubscriptionPrices} from '../dist/contracts/subscriptionPricing.js';
const now=new Date('2026-09-19T12:00:00Z'), before=new Date(now.getTime()-1),after=new Date(now.getTime()+1);
for(const status of ['PAST_DUE','GRACE_PERIOD','BILLING_RETRY'])test(status+' honors verified grace through the exact expiry boundary',()=>{
 const evidence={status,verifiedAt:before,gracePeriodEnd:after,currentPeriodEnd:after};
 assert.equal(canSuspendForPayment(evidence,now),false);
 assert.equal(canSuspendForPayment({...evidence,gracePeriodEnd:now},now),true);
 assert.equal(canSuspendForPayment({...evidence,verifiedAt:null,gracePeriodEnd:before},now),false);
 const source={id:'test',status,startsAt:before,accessEndsAt:new Date(now.getTime()+86400000),gracePeriodEndsAt:after};
 assert.equal(isEntitlementSourceActive(source,now),true);assert.equal(isEntitlementSourceActive({...source,gracePeriodEndsAt:now},now),false);
 assert.equal(entitlementSourceEnd(source),after);assert.equal(entitlementCacheDeadline(now,after,24,5),after);
});
test('unknown/unverified payment cannot grant a restore or create an indefinite retry',()=>{
 for(const status of ['ACTIVE','CANCEL_AT_PERIOD_END']) {
 const s={status,verifiedAt:before,currentPeriodEnd:after,gracePeriodEnd:null};assert.equal(canRestorePaidAccess(s,now),true);
 assert.equal(canRestorePaidAccess({...s,verifiedAt:null},now),false);assert.equal(canRestorePaidAccess({...s,currentPeriodEnd:now},now),false);
 }
 for(const status of ['PAST_DUE','GRACE_PERIOD','BILLING_RETRY']) {
 assert.equal(canRestorePaidAccess({status,verifiedAt:before,currentPeriodEnd:after,gracePeriodEnd:after},now),false);
 assert.equal(isEntitlementSourceActive({id:'t',status,startsAt:before,accessEndsAt:null,gracePeriodEndsAt:null},now),false);
 }
});
test('price validation rejects invalid money, increasing volume tiers and excessive introduction',()=>{
 assert(pricingValuesSchema.safeParse(defaultSubscriptionPrices).success);
 for(const amount of [-1,0,1.5,1000001,NaN,Infinity])assert(!pricingValuesSchema.safeParse({...defaultSubscriptionPrices,annual:amount}).success);
 assert(!pricingValuesSchema.safeParse({...defaultSubscriptionPrices,monthlyIntro:9999}).success);
 assert(!pricingValuesSchema.safeParse({...defaultSubscriptionPrices,fleet100:9999}).success);
 assert(!pricingValuesSchema.safeParse({...defaultSubscriptionPrices,providerPriceId:'not-allowed'}).success);
});
test('access change requires a matching explicit confirmation, reason and version',()=>{
 const input={suspended:true,confirmation:'SUSPEND',reason:'Verified overdue',expectedVersion:0};assert(holdUpdateSchema.safeParse(input).success);
 for(const change of [{confirmation:'RESTORE'},{reason:''},{expectedVersion:-1},{paid:true}])assert(!holdUpdateSchema.safeParse({...input,...change}).success);
});
