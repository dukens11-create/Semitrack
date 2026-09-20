import test, { after } from 'node:test';
let closeDatabase: (() => Promise<void>) | undefined;
after(async () => { await closeDatabase?.(); });
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { requireIsolatedDatabase } from './isolatedDatabaseGuard.ts';

test('account offer endpoint enforces authentication, ownership, verified-only records and no entitlement writes',
  { skip: !process.env.SUBSCRIPTION_TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = requireIsolatedDatabase(process.env.SUBSCRIPTION_TEST_DATABASE_URL);
  const { prisma, disconnectDatabase } = await import('../dist/lib/prisma.js');
  closeDatabase = disconnectDatabase;
  const { subscriptionOffersRouter } = await import('../dist/modules/subscriptions/subscriptionOffers.routes.js');
  const { signAccessToken } = await import('../dist/utils/jwt.js');
  const app = express(); app.use('/subscription-offers', subscriptionOffersRouter);
  const server = app.listen(0,'127.0.0.1'); await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address(); assert(address && typeof address !== 'string');
  const base='http://127.0.0.1:'+address.port+'/subscription-offers';
  const users: string[]=[];
  try {
    const publicResponse=await fetch(base); assert.equal(publicResponse.status,200);
    const catalog=await publicResponse.json() as any; assert.equal(catalog.catalog.trialDays,14); assert.equal(catalog.purchaseAvailable,false);
    assert.equal((await fetch(base+'/account')).status,401);
    const a=await prisma.user.create({data:{email:randomUUID()+'@example.invalid',fullName:'Pricing fixture',passwordHash:'test-only'}});users.push(a.id);
    const b=await prisma.user.create({data:{email:randomUUID()+'@example.invalid',fullName:'Other fixture',passwordHash:'test-only'}});users.push(b.id);
    const session=await prisma.refreshToken.create({data:{userId:a.id,tokenHash:randomUUID(),expiresAt:new Date(Date.now()+60000)}});
    const token=signAccessToken({userId:a.id,email:a.email,role:a.role,sessionId:session.id});
    await prisma.subscription.create({data:{userId:a.id,provider:'GOOGLE_PLAY',providerSubscriptionId:randomUUID(),productId:'semitrax_premium',plan:'GOLD',status:'ACTIVE',environment:'TEST',verifiedAt:new Date(),priceAmountCents:999,priceCurrency:'USD',rawEventJson:{secret:'MUST_NOT_APPEAR'}}});
    await prisma.subscription.create({data:{userId:a.id,provider:'GOOGLE_PLAY',productId:'unverified',plan:'DIAMOND',status:'ACTIVE'}});
    await prisma.subscription.create({data:{userId:b.id,provider:'APPLE',productId:'other-user',plan:'TEAM',status:'ACTIVE',verifiedAt:new Date()}});
    const entitlementsBefore=await prisma.entitlementSource.count({where:{userId:a.id}});
    const read=()=>fetch(base+'/account?eligible=true&premium=true',{headers:{Authorization:'Bearer '+token}});
    let response=await read(); assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
    let body=await response.json() as any;assert.equal(body.subscriptions.length,1);assert.equal(body.subscriptions[0].plan,'GOLD');assert.equal(body.subscriptions[0].nextBillingCents,null);
    assert.equal(body.monthlyEligibility,'provider_not_configured');assert.equal(body.purchaseAvailable,false);
    assert(!JSON.stringify(body).includes('MUST_NOT_APPEAR')); assert(!JSON.stringify(body).includes(a.email)); assert(!JSON.stringify(body).includes('providerSubscriptionId'));
    await prisma.subscriptionOfferRedemption.create({data:{userId:a.id,provider:'GOOGLE_PLAY',offerKind:'REGULAR_TRIAL',status:'REDEEMED'}});
    response=await read();body=await response.json() as any;assert.equal(body.monthlyEligibility,'already_used');
    assert.equal(await prisma.entitlementSource.count({where:{userId:a.id}}),entitlementsBefore);
    assert.equal((await fetch(base+'/account',{method:'POST',headers:{Authorization:'Bearer '+token}})).status,404);
    assert.equal((await prisma.subscription.findFirstOrThrow({where:{userId:a.id,verifiedAt:{not:null}}})).priceAmountCents,999,'grandfathered price untouched');
  } finally { await new Promise<void>(resolve=>server.close(()=>resolve()));await prisma.user.deleteMany({where:{id:{in:users}}}); }
});

test('verified subscription processor rejects same-offer rejoin and stacking transactionally while preserving renewals',
 { skip: !process.env.SUBSCRIPTION_TEST_DATABASE_URL }, async()=>{
  process.env.DATABASE_URL=requireIsolatedDatabase(process.env.SUBSCRIPTION_TEST_DATABASE_URL);
  const {prisma,disconnectDatabase}=await import('../dist/lib/prisma.js');
  closeDatabase = disconnectDatabase;
  const {applyVerifiedSubscriptionUpdate}=await import('../dist/modules/billing/subscriptionFoundation.service.js');
  const user=await prisma.user.create({data:{email:randomUUID()+'@example.invalid',fullName:'Offer fixture',passwordHash:'test-only'}});
  const eventIds:string[]=[];
  const original=randomUUID();
  const update=(subscription:string,kind:'INTRODUCTORY_OFFER'|'REGULAR_TRIAL'='INTRODUCTORY_OFFER',offset=0)=>{
    const id=randomUUID();eventIds.push(id);
    return {provider:'GOOGLE_PLAY' as const,providerEventId:id,eventType:'LOCAL_TEST',rawPayload:JSON.stringify({id}),eventCreatedAt:new Date(Date.now()+offset),userId:user.id,providerSubscriptionId:subscription,productId:'semitrax_premium',plan:'GOLD' as const,status:'ACTIVE' as const,environment:'TEST' as const,offerKind:kind,currentPeriodStart:new Date(),currentPeriodEnd:new Date(Date.now()+86400000)};
  };
  try {
    await applyVerifiedSubscriptionUpdate(update(original));
    const renewal=await applyVerifiedSubscriptionUpdate(update(original,'INTRODUCTORY_OFFER',1000));assert.equal(renewal.ignored,false);
    const rejoin=randomUUID();await assert.rejects(applyVerifiedSubscriptionUpdate(update(rejoin,'INTRODUCTORY_OFFER',2000)),(e:any)=>e.code==='WELCOME_OFFER_ALREADY_USED');
    assert.equal(await prisma.subscription.count({where:{userId:user.id,providerSubscriptionId:rejoin}}),0);
    await assert.rejects(applyVerifiedSubscriptionUpdate(update(randomUUID(),'REGULAR_TRIAL',3000)),(e:any)=>e.code==='WELCOME_OFFER_ALREADY_USED');
    assert.equal(await prisma.subscription.count({where:{userId:user.id}}),1);assert.equal(await prisma.subscriptionOfferRedemption.count({where:{userId:user.id}}),1);
  } finally {await prisma.user.delete({where:{id:user.id}});await prisma.providerEvent.deleteMany({where:{providerEventId:{in:eventIds}}});}
});
