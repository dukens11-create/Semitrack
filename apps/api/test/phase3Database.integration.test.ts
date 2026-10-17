import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { requireIsolatedDatabase } from './isolatedDatabaseGuard.ts';
const enabled = !!process.env.SUBSCRIPTION_TEST_DATABASE_URL;
let module: any;
async function database() {
  process.env.DATABASE_URL = requireIsolatedDatabase(
    process.env.SUBSCRIPTION_TEST_DATABASE_URL,
  );
  module ??= await import('../dist/lib/prisma.js');
  return module.prisma;
}
after(async () => {
  await module?.disconnectDatabase();
});
const fixture = {
  name: 'Synthetic truck',
  tractorType: 'Sleeper Cab',
  trailerType: 'Dry Van',
  trailerCount: 1,
  heightFt: 13.5,
  widthFt: 8.5,
  lengthFt: 53,
  weightLbs: 80000,
  axleCount: 5,
  hazmatEnabled: false,
  hazardousGoods: [],
  avoidResidential: false,
  avoidDirtRoads: false,
};
const plan = () => ({
  createOperationId: crypto.randomUUID(),
  name: 'Synthetic trip',
  origin: { id: 'o', name: 'Origin', lat: 40, lng: -120 },
  stops: [
    { id: 'a', name: 'First stop', lat: 40.1, lng: -120 },
    { id: 'b', name: 'Second stop', lat: 40.2, lng: -120 },
  ],
  destination: { id: 'd', name: 'Destination', lat: 40.3, lng: -120 },
});
async function user(db: any, role = 'DRIVER') {
  return db.user.create({
    data: {
      email: crypto.randomUUID() + '@example.invalid',
      fullName: 'Synthetic fixture',
      passwordHash: 'synthetic-only',
      role,
    },
  });
}
test(
  'trip lifecycle, ownership, ordered plans, replay, revision and truck gates use real PostgreSQL',
  { skip: !enabled },
  async () => {
    const db = await database();
    const { createTrip, transitionTrip, publicTrip, selectTripTruck } =
      await import('../dist/modules/trips/trip-status.routes.js');
    const { saveTruck, verifyTruck } = await import(
      '../dist/modules/trucks/profileRevision.js'
    );
    const a = await user(db),
      b = await user(db),
      truck = await saveTruck(db, a.id, a.id, fixture),
      body = { ...plan(), truckId: truck.id, expectedTruckRevision: 1 };
    const saved = await db.$transaction((tx: any) =>
      createTrip(tx, a.id, body),
    );
    assert.deepEqual(publicTrip(saved).stops, body.stops);
    assert.equal(publicTrip(saved).destination.id, 'd');
    assert.equal(saved.distanceMiles, null);
    assert.equal(saved.truckSafe, false);
    assert.equal(
      (await db.$transaction((tx: any) => createTrip(tx, a.id, body))).id,
      saved.id,
    );
    await assert.rejects(
      () =>
        db.$transaction((tx: any) =>
          createTrip(tx, a.id, { ...body, name: 'Changed same operation' }),
        ),
      (e: any) => e.safeCode === 'CREATE_OPERATION_CONFLICT',
    );
    await assert.rejects(
      () =>
        transitionTrip(db, b.id, saved.id, {
          expectedRevision: 1,
          status: 'STARTED',
        }),
      (e: any) => e.safeStatus === 404,
    );
    await assert.rejects(
      () =>
        transitionTrip(db, a.id, saved.id, {
          expectedRevision: 1,
          status: 'COMPLETED',
        }),
      (e: any) => e.safeCode === 'TRIP_TRANSITION_INVALID',
    );
    await assert.rejects(
      () =>
        transitionTrip(db, a.id, saved.id, {
          expectedRevision: 1,
          status: 'STARTED',
        }),
      (e: any) => e.safeCode === 'VERIFIED_TRUCK_REQUIRED',
    );
    await verifyTruck(db, a.id, truck.id, 1);
    const current = await selectTripTruck(db, a.id, saved.id, {
      expectedRevision: 1,
      truckId: truck.id,
      expectedTruckRevision: 1,
    });
    assert.equal(current.revision, 2);
    const started = await transitionTrip(db, a.id, saved.id, {
      expectedRevision: 2,
      status: 'STARTED',
    });
    assert.ok(started.startedAt);
    await assert.rejects(
      () =>
        transitionTrip(db, a.id, saved.id, {
          expectedRevision: 2,
          status: 'IN_PROGRESS',
        }),
      (e: any) => e.safeCode === 'TRIP_CHANGED',
    );
    const moving = await transitionTrip(db, a.id, saved.id, {
      expectedRevision: 3,
      status: 'IN_PROGRESS',
    });
    const completed = await transitionTrip(db, a.id, saved.id, {
      expectedRevision: moving.revision,
      status: 'COMPLETED',
    });
    assert.ok(completed.completedAt);
    assert.equal(completed.actualDistanceMiles, null);
    await assert.rejects(() =>
      transitionTrip(db, a.id, saved.id, {
        expectedRevision: completed.revision,
        status: 'STARTED',
      }),
    );
    const next = await db.$transaction((tx: any) =>
      createTrip(tx, a.id, plan()),
    );
    assert.notEqual(next.id, saved.id);
    assert.ok(
      (
        await transitionTrip(db, a.id, next.id, {
          expectedRevision: 1,
          status: 'CANCELLED',
        })
      ).cancelledAt,
    );
    await assert.rejects(() =>
      db.$transaction((tx: any) =>
        createTrip(tx, a.id, {
          ...plan(),
          routeGeometry: [
            [0, 0],
            [1, 1],
          ],
        }),
      ),
    );
    await assert.rejects(() =>
      db.$transaction((tx: any) =>
        createTrip(tx, a.id, {
          ...plan(),
          truckId: truck.id,
          expectedTruckRevision: 99,
        }),
      ),
    );
  },
);
test(
  'document ownership, dates, server-only verification and public-URL exclusion',
  { skip: !enabled },
  async () => {
    const db = await database();
    const { saveDocumentMetadata, publicDocument } = await import(
      '../dist/modules/documents/document.routes.js'
    );
    const a = await user(db),
      b = await user(db),
      metadata = {
        createOperationId: crypto.randomUUID(),
        type: 'CDL',
        fileName: 'Synthetic document',
        issuedOn: '2025-01-01',
        expiresOn: '2025-12-31',
      };
    const d = await saveDocumentMetadata(db, a.id, metadata);
    assert.equal(d.fileUrl, '');
    assert.equal(d.verificationState, 'UNVERIFIED');
    assert.equal((await saveDocumentMetadata(db, a.id, metadata)).id, d.id);
    assert.equal(await db.document.count({ where: { userId: a.id } }), 1);
    await assert.rejects(
      () =>
        saveDocumentMetadata(db, b.id, { expectedRevision: 1, metadata }, d.id),
      (e: any) => e.safeStatus === 404,
    );
    const changed = await saveDocumentMetadata(
      db,
      a.id,
      {
        expectedRevision: 1,
        metadata: { ...metadata, expiresOn: '2027-01-01' },
      },
      d.id,
    );
    assert.equal(changed.revision, 2);
    await assert.rejects(
      () =>
        saveDocumentMetadata(db, a.id, { expectedRevision: 1, metadata }, d.id),
      (e: any) => e.safeCode === 'DOCUMENT_CHANGED',
    );
    for (const patch of [
      { expiresOn: '2024-01-01' },
      { issuedOn: '2026-02-31' },
      { fileUrl: 'https://public.invalid/private.pdf' },
      { verificationState: 'VERIFIED' },
    ])
      await assert.rejects(() =>
        saveDocumentMetadata(db, a.id, { ...metadata, ...patch }),
      );
    await db.document.update({
      where: { id: d.id },
      data: { fileUrl: 'https://legacy.invalid/private-file' },
    });
    assert.equal(
      JSON.stringify(
        publicDocument(
          await db.document.findUniqueOrThrow({ where: { id: d.id } }),
        ),
      ).includes('https://'),
      false,
    );
    assert.equal(publicDocument(d).expired, true);
    await assert.rejects(() =>
      db.$executeRawUnsafe(
        'UPDATE "Document" SET "expiresOn"=\'2020-01-01\' WHERE "id"=$1',
        d.id,
      ),
    );
    assert.equal(
      (await db.document.findUniqueOrThrow({ where: { id: d.id } })).expiresOn
        .toISOString()
        .slice(0, 10),
      '2027-01-01',
    );
  },
);
test(
  'dispatch is fleet-scoped, ordered, explicit acceptance and privileged audit is secret-free',
  { skip: !enabled },
  async () => {
    const db = await database();
    const { assignTripToDriver } = await import(
      '../dist/modules/dispatch/dispatch.routes.js'
    );
    const { transitionTrip } = await import(
      '../dist/modules/trips/trip-status.routes.js'
    );
    const staff = await user(db),
      driver = await user(db),
      other = await user(db),
      outsider = await user(db);
    const fleet = await db.operationalFleet.create({
        data: { name: 'Synthetic dispatch fleet' },
      }),
      otherFleet = await db.operationalFleet.create({
        data: { name: 'Other fleet' },
      });
    await db.staffAccess.create({
      data: {
        userId: staff.id,
        role: 'DISPATCH',
        fleets: { create: { fleetId: fleet.id } },
      },
    });
    await db.operationalFleetDriver.create({
      data: { userId: driver.id, fleetId: fleet.id },
    });
    await db.operationalFleetDriver.create({
      data: { userId: other.id, fleetId: otherFleet.id },
    });
    const body = {
      fleetId: fleet.id,
      driverId: driver.id,
      plan: plan(),
      reason: 'Synthetic test assignment',
    };
    for (const [actor, patch] of [
      [outsider.id, {}],
      [staff.id, { driverId: other.id }],
      [staff.id, { fleetId: otherFleet.id, driverId: other.id }],
    ])
      await assert.rejects(() =>
        assignTripToDriver(db, actor, { ...body, ...patch }),
      );
    const assigned = await assignTripToDriver(db, staff.id, body);
    assert.equal(assigned.status, 'ASSIGNED');
    assert.deepEqual(assigned.viaStopsJson, body.plan.stops);
    assert.equal(
      (await assignTripToDriver(db, staff.id, body)).id,
      assigned.id,
    );
    assert.equal(
      await db.adminAuditLog.count({
        where: { targetId: assigned.id, action: 'TRIP_ASSIGNED' },
      }),
      1,
    );
    const audit = await db.adminAuditLog.findFirstOrThrow({
      where: { targetId: assigned.id, action: 'TRIP_ASSIGNED' },
    });
    assert.equal(audit.actorUserId, staff.id);
    assert.deepEqual(Object.keys(audit.metadataJson).sort(), [
      'fleetId',
      'result',
      'revision',
    ]);
    const accepted = await transitionTrip(db, driver.id, assigned.id, {
      expectedRevision: 1,
      status: 'PLANNED',
    });
    assert.equal(accepted.status, 'PLANNED');
    const rejected = await assignTripToDriver(db, staff.id, {
      ...body,
      plan: plan(),
    });
    assert.equal(
      (
        await transitionTrip(db, driver.id, rejected.id, {
          expectedRevision: 1,
          status: 'CANCELLED',
        })
      ).status,
      'CANCELLED',
    );
    const disabledAssignment = await assignTripToDriver(db, staff.id, {
      ...body,
      plan: plan(),
    });
    await db.operationalFleetDriver.update({
      where: { fleetId_userId: { fleetId: fleet.id, userId: driver.id } },
      data: { active: false },
    });
    await assert.rejects(
      () =>
        transitionTrip(db, driver.id, disabledAssignment.id, {
          expectedRevision: 1,
          status: 'PLANNED',
        }),
      (e: any) => e.safeCode === 'DISPATCH_MEMBERSHIP_REQUIRED',
    );
  },
);
test(
  'real reset expiration/single-use/racing tokens revoke sessions; password change invalidates outstanding links',
  { skip: !enabled },
  async () => {
    const db = await database();
    const { confirmPasswordRecovery, changeUserPassword } = await import(
      '../dist/services/passwordRecovery.js'
    );
    const { hashPassword, comparePassword } = await import(
      '../dist/utils/password.js'
    );
    const { currentAccessSession } = await import(
      '../dist/services/accessSession.js'
    );
    const a = await user(db);
    await db.user.update({
      where: { id: a.id },
      data: { passwordHash: await hashPassword('Old synthetic password') },
    });
    const session = await db.refreshToken.create({
      data: {
        userId: a.id,
        tokenHash: crypto.randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    async function reset(expired = false) {
      const token = crypto.randomBytes(48).toString('hex');
      await db.passwordResetToken.create({
        data: {
          userId: a.id,
          tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() + (expired ? -1000 : 600000)),
        },
      });
      return token;
    }
    assert.equal(
      await confirmPasswordRecovery(
        db,
        await reset(true),
        'New synthetic password',
      ),
      false,
    );
    const first = await reset(),
      second = await reset();
    const results = await Promise.all([
      confirmPasswordRecovery(db, first, 'First synthetic password'),
      confirmPasswordRecovery(db, second, 'Second synthetic password'),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(
      await confirmPasswordRecovery(db, first, 'Replay synthetic password'),
      false,
    );
    assert.equal(
      await confirmPasswordRecovery(db, second, 'Replay synthetic password'),
      false,
    );
    assert.equal(
      await currentAccessSession(db, { userId: a.id, sessionId: session.id }),
      null,
    );
    const winning = results[0]
      ? 'First synthetic password'
      : 'Second synthetic password';
    const unused = await reset();
    await changeUserPassword(db, a.id, winning, 'Changed synthetic password');
    assert.equal(
      await comparePassword(
        'Changed synthetic password',
        (
          await db.user.findUniqueOrThrow({ where: { id: a.id } })
        ).passwordHash,
      ),
      true,
    );
    assert.equal(
      await confirmPasswordRecovery(db, unused, 'Should not work password'),
      false,
    );
    await assert.rejects(
      () =>
        changeUserPassword(
          db,
          a.id,
          'wrong password',
          'Unused synthetic password',
        ),
      (e: any) => e.safeCode === 'CURRENT_PASSWORD_INVALID',
    );
    const disabled = await reset();
    await db.user.update({
      where: { id: a.id },
      data: { disabledAt: new Date() },
    });
    assert.equal(
      await confirmPasswordRecovery(db, disabled, 'Should not work password'),
      false,
    );
  },
);
test(
  'refresh racing password reset cannot leave an unrevoked old-password session',
  { skip: !enabled },
  async () => {
    const db = await database();
    const { rotateRefreshSession } = await import(
      '../dist/services/sessionRotation.js'
    );
    const { confirmPasswordRecovery } = await import(
      '../dist/services/passwordRecovery.js'
    );
    const a = await user(db),
      refreshHash = crypto.randomBytes(32).toString('hex'),
      reset = crypto.randomBytes(48).toString('hex');
    await db.refreshToken.create({
      data: {
        userId: a.id,
        tokenHash: refreshHash,
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    await db.passwordResetToken.create({
      data: {
        userId: a.id,
        tokenHash: crypto.createHash('sha256').update(reset).digest('hex'),
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    await Promise.all([
      rotateRefreshSession(db, refreshHash, async (u: any, tx: any) =>
        tx.refreshToken.create({
          data: {
            userId: u.id,
            tokenHash: crypto.randomBytes(32).toString('hex'),
            expiresAt: new Date(Date.now() + 600000),
          },
        }),
      ),
      confirmPasswordRecovery(db, reset, 'Replacement synthetic password'),
    ]);
    assert.equal(
      await db.refreshToken.count({ where: { userId: a.id, revokedAt: null } }),
      0,
    );
  },
);
test(
  'RBAC least-privilege allow/deny matrix and unknown HOS never inferred',
  { skip: !enabled },
  async () => {
    const { can, requirePermission } = await import(
      '../dist/modules/admin/operationalPolicy.js'
    );
    const { normalizeEldSnapshot, currentHosStatus } = await import(
      '../dist/services/eldNormalization.js'
    );
    const roles = [
      'SUPER_ADMIN',
      'OPERATIONS',
      'DISPATCH',
      'SAFETY',
      'SUPPORT',
      'BILLING',
      'READ_ONLY',
    ];
    for (const role of roles) {
      const actor = {
        userId: 'synthetic',
        role,
        globalScope: false,
        fleetIds: [],
      };
      assert.equal(can(actor, 'roles.manage'), role === 'SUPER_ADMIN');
      if (role !== 'SUPER_ADMIN')
        assert.throws(() => requirePermission(actor, 'roles.manage'));
    }
    for (const value of [null, '', false, ' ', undefined]) {
      const result = normalizeEldSnapshot('SAMSARA', {
        drivers: [],
        vehicles: [],
        hos: [{ driverId: 'synthetic', remainingDriveTime: value }],
      });
      assert.equal(result.hos[0].remainingDriveSeconds, undefined);
    }
    assert.equal(currentHosStatus([]).status, 'UNKNOWN');
    assert.equal(
      currentHosStatus([
        {
          lastSyncedAt: new Date(0),
          metadataJson: { hos: [{ remainingDriveSeconds: 99999 }] },
        },
      ]).reason,
      'ELD_DATA_STALE',
    );
    assert.equal(
      currentHosStatus([
        {
          lastSyncedAt: new Date(),
          metadataJson: { hos: [{ remainingDriveSeconds: 99999 }] },
        },
      ]).reason,
      'DRIVER_MAPPING_REQUIRED',
    );
  },
);

test(
  'trip and document concurrent creates, owner isolation and transaction rollback retain one logical operation',
  { skip: !enabled },
  async () => {
    const db = await database();
    const { createTrip } = await import(
      '../dist/modules/trips/trip-status.routes.js'
    );
    const { saveDocumentMetadata } = await import(
      '../dist/modules/documents/document.routes.js'
    );
    const a = await user(db),
      b = await user(db),
      body = plan();
    const create = () =>
      db.$transaction((tx: any) => createTrip(tx, a.id, body), {
        isolationLevel: 'Serializable',
      });
    await Promise.allSettled([create(), create()]);
    const first = await create();
    assert.equal(await db.trip.count({ where: { userId: a.id } }), 1);
    const other = await db.$transaction((tx: any) =>
      createTrip(tx, b.id, body),
    );
    assert.notEqual(first.id, other.id);
    const rollback = plan();
    await assert.rejects(() =>
      db.$transaction(async (tx: any) => {
        await createTrip(tx, a.id, rollback);
        throw Error('Synthetic rollback');
      }),
    );
    const auditId =
      'trip-create:' +
      crypto
        .createHash('sha256')
        .update(JSON.stringify([a.id, rollback.createOperationId]))
        .digest('hex');
    assert.equal(await db.adminAuditLog.count({ where: { id: auditId } }), 0);
    assert.equal(await db.trip.count({ where: { userId: a.id } }), 1);
    const metadata = {
      createOperationId: crypto.randomUUID(),
      type: 'CDL',
      fileName: 'Synthetic concurrency',
    };
    await Promise.allSettled([
      saveDocumentMetadata(db, a.id, metadata),
      saveDocumentMetadata(db, a.id, metadata),
    ]);
    const doc = await saveDocumentMetadata(db, a.id, metadata);
    assert.equal(await db.document.count({ where: { userId: a.id } }), 1);
    assert.equal((await saveDocumentMetadata(db, a.id, metadata)).id, doc.id);
    assert.notEqual(
      (await saveDocumentMetadata(db, b.id, metadata)).id,
      doc.id,
    );
  },
);

test('new passwords reject bcrypt truncation by UTF-8 bytes without altering existing comparison', async () => {
  const { hashPassword, comparePassword } = await import(
    '../dist/utils/password.js'
  );
  const allowed = 'a'.repeat(72),
    hash = await hashPassword(allowed);
  assert.equal(await comparePassword(allowed, hash), true);
  for (const value of ['a'.repeat(73), '🙂'.repeat(19)])
    await assert.rejects(
      () => hashPassword(value),
      (e: any) => e.safeCode === 'PASSWORD_TOO_LONG' && e.safeStatus === 400,
    );
});

test('dispatch pickup completion is explicit ordered revisioned state, survives reread/replay, and never follows GPS implicitly', {skip:!enabled}, async()=>{
 const db=await database();
 const {assignTripToDriver}=await import('../dist/modules/dispatch/dispatch.routes.js');
 const {transitionTrip,publicTrip,selectTripTruck}=await import('../dist/modules/trips/trip-status.routes.js');
 const {saveTruck,verifyTruck}=await import('../dist/modules/trucks/profileRevision.js');
 const actor=await user(db,'ADMIN'),driver=await user(db),other=await user(db);
 const fleet=await db.operationalFleet.create({data:{name:'Synthetic pickup fleet'}});
 await db.operationalFleetDriver.create({data:{fleetId:fleet.id,userId:driver.id}});
 const truck=await saveTruck(db,driver.id,driver.id,fixture);await verifyTruck(db,driver.id,truck.id,1);
 const body={fleetId:fleet.id,driverId:driver.id,plan:{...plan(),truckId:truck.id,expectedTruckRevision:1},reason:'Synthetic ordered pickup test'};
 const assigned=await assignTripToDriver(db,actor.id,body);assert.deepEqual(publicTrip(assigned).completedStopIds,[]);
 await assert.rejects(()=>transitionTrip(db,driver.id,assigned.id,{expectedRevision:1,status:'IN_PROGRESS',completedStopId:'o'}));
 await transitionTrip(db,driver.id,assigned.id,{expectedRevision:1,status:'PLANNED'});
 const selected=await selectTripTruck(db,driver.id,assigned.id,{expectedRevision:2,truckId:truck.id,expectedTruckRevision:1});
 const started=await transitionTrip(db,driver.id,assigned.id,{expectedRevision:selected.revision,status:'STARTED'});
 for(const id of ['a','b','d'])await assert.rejects(()=>transitionTrip(db,driver.id,assigned.id,{expectedRevision:started.revision,status:'IN_PROGRESS',completedStopId:id}), (e:any)=>e.safeCode==='TRIP_STOP_PLAN_INVALID');
 await assert.rejects(()=>transitionTrip(db,other.id,assigned.id,{expectedRevision:started.revision,status:'IN_PROGRESS',completedStopId:'o'}),(e:any)=>e.safeStatus===404);
 const outcomes=await Promise.allSettled([0,1].map(()=>transitionTrip(db,driver.id,assigned.id,{expectedRevision:started.revision,status:'IN_PROGRESS',completedStopId:'o'})));
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 let saved=await db.trip.findUniqueOrThrow({where:{id:assigned.id}});assert.deepEqual(publicTrip(saved).completedStopIds,['o']);
 assert.deepEqual(publicTrip(await assignTripToDriver(db,actor.id,body)).completedStopIds,['o']);
 assert.equal(await db.trip.count({where:{userId:driver.id}}),1);
 await assert.rejects(()=>transitionTrip(db,driver.id,assigned.id,{expectedRevision:started.revision,status:'IN_PROGRESS',completedStopId:'o'}),(e:any)=>e.safeCode==='TRIP_CHANGED');
 await assert.rejects(()=>transitionTrip(db,driver.id,assigned.id,{expectedRevision:saved.revision,status:'IN_PROGRESS',completedStopId:'o'}),(e:any)=>e.safeCode==='TRIP_STOP_PLAN_INVALID');
 saved=await transitionTrip(db,driver.id,assigned.id,{expectedRevision:saved.revision,status:'IN_PROGRESS',completedStopId:'a'});
 assert.deepEqual(publicTrip(saved).completedStopIds,['o','a']);assert.deepEqual(publicTrip(saved).stops,body.plan.stops);
 assert.equal(await db.adminAuditLog.count({where:{targetId:assigned.id,action:'TRIP_STOP_COMPLETED'}}),2);
 await db.operationalFleetDriver.update({where:{fleetId_userId:{fleetId:fleet.id,userId:driver.id}},data:{active:false}});
 await assert.rejects(()=>transitionTrip(db,driver.id,assigned.id,{expectedRevision:saved.revision,status:'IN_PROGRESS',completedStopId:'b'}),(e:any)=>e.safeCode==='DISPATCH_MEMBERSHIP_REQUIRED');
 for(const stops of [[{...body.plan.origin}],Array.from({length:20},(_,i)=>({...body.plan.origin,id:'s'+i}))])await assert.rejects(()=>assignTripToDriver(db,actor.id,{...body,plan:{...plan(),stops}}));
});

test('document committed response loss and reconstructed client identity replay exactly one row on real PostgreSQL', {skip:!enabled},async()=>{
 const db=await database();const {saveDocumentMetadata}=await import('../dist/modules/documents/document.routes.js');const owner=await user(db),other=await user(db);
 const body={createOperationId:crypto.randomUUID(),type:'INSURANCE',fileName:'Synthetic restored operation',truckId:null,issuedOn:null,expiresOn:null};
 const durable=JSON.stringify(body);let originalId:string|undefined;
 await assert.rejects(async()=>{const committed=await saveDocumentMetadata(db,owner.id,body);originalId=committed.id;throw Error('Synthetic response lost after commit');});
 const retry=await saveDocumentMetadata(db,owner.id,JSON.parse(durable));assert.equal(retry.id,originalId);assert.equal(await db.document.count({where:{userId:owner.id}}),1);
 const next=await saveDocumentMetadata(db,owner.id,{...body,createOperationId:crypto.randomUUID()});assert.notEqual(next.id,retry.id);assert.equal(await db.document.count({where:{userId:owner.id}}),2);
 const isolated=await saveDocumentMetadata(db,other.id,JSON.parse(durable));assert.notEqual(isolated.id,retry.id);assert.equal(isolated.userId,other.id);
});
