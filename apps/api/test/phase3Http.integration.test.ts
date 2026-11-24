import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { requireIsolatedDatabase } from './isolatedDatabaseGuard.ts';

test(
  'mounted Phase3 API enforces auth, ownership, revisions, privilege boundaries and password session invalidation',
  { skip: !process.env.SUBSCRIPTION_TEST_DATABASE_URL, timeout: 60000 },
  async () => {
    const databaseUrl = requireIsolatedDatabase(
      process.env.SUBSCRIPTION_TEST_DATABASE_URL,
    );
    process.env.DATABASE_URL=databaseUrl;
    const {prisma:db,disconnectDatabase}=await import('../dist/lib/prisma.js');
    const port = await new Promise<number>((resolve) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as net.AddressInfo).port;
        server.close(() => resolve(port));
      });
    });
    const child = spawn(process.execPath, ['dist/server.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        PORT: String(port),
        NODE_ENV: 'test',
        BILLING_MODE: 'disabled',
        DOT_PROVIDER_CONFIG_JSON: '[]',
      },
      windowsHide: true,
      stdio: 'ignore',
    });
    const done = once(child, 'exit');
    let spawnError: unknown;
    child.on('error', (e) => (spawnError = e));
    const base = 'http://127.0.0.1:' + port;
    async function request(
      method: string,
      path: string,
      body?: unknown,
      access?: string,
    ) {
      const r = await fetch(base + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(access ? { Authorization: 'Bearer ' + access } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(5000),
      });
      const text = await r.text();
      return { status: r.status, body: text ? JSON.parse(text) : null };
    }
    try {
      let ready = false;
      for (let i = 0; i < 60; i++) {
        if (spawnError) throw spawnError;
        try {
          ready = (await request('GET', '/health')).status === 200;
          if (ready) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      assert(ready, 'isolated HTTP API must start');
      for (const path of [
        '/capabilities',
        '/trips',
        '/documents',
        '/dispatch',
        '/admin/operations/audit',
      ])
        assert.equal((await request('GET', path)).status, 401);
      const email = crypto.randomUUID() + '@example.invalid',
        password = 'Synthetic password only 42';
      const a = await request('POST', '/auth/register', {
        email,
        password,
        fullName: 'Synthetic A',
        role: 'ADMIN',
        isAdmin: true,
      });
      assert.equal(a.status, 201);
      assert.equal(a.body.user.role, 'DRIVER');
      assert.equal(JSON.stringify(a.body.user).includes('passwordHash'), false);
      const b = await request('POST', '/auth/register', {
        email: crypto.randomUUID() + '@example.invalid',
        password,
        fullName: 'Synthetic B',
      });
      assert.equal(b.status, 201);
      assert.equal(
        (
          await request('POST', '/auth/login', {
            email,
            password: 'Incorrect synthetic password',
          })
        ).status,
        401,
      );
      const login = await request('POST', '/auth/login', { email, password });
      assert.equal(login.status, 200);
      const access = login.body.accessToken;
      for (const path of ['/dispatch', '/admin/operations/audit'])
        assert.equal(
          (await request('GET', path, undefined, access)).status,
          403,
        );
      const capabilities=await request('GET','/capabilities',undefined,access);
      assert.equal(capabilities.status,200);assert.equal(capabilities.body.contractVersion,'rn-p0-v1');
      assert.equal(capabilities.body.truckRouting.provider,'Trimble');assert.equal(capabilities.body.truckRouting.status,'NOT_CONFIGURED');
      assert.equal(capabilities.body.turnByTurn.available,false);assert.equal(capabilities.body.turnByTurn.licenseStatus,'UNVERIFIED');
      const truckBody={name:'Contract truck',isDefault:false,heightFt:13.5,widthFt:8.5,lengthFt:53,weightLbs:80000,currentWeightLbs:72000,weightPerAxleLbs:20000,axleCount:5,trailerCount:1,trailerType:'Dry Van',tractorType:null,hazmatEnabled:false,hazardousGoods:[],avoidTolls:false,avoidFerries:false,avoidHighways:false,avoidResidential:true,avoidDirtRoads:true,createOperationId:crypto.randomUUID()};
      const saved=await request('POST','/trucks',truckBody,access);assert.equal(saved.status,201);assert.equal(saved.body.verificationState,'DRIVER_VERIFICATION_REQUIRED');
      const replay=await request('POST','/trucks',truckBody,access);assert.equal(replay.body.id,saved.body.id);
      const conflict=await request('POST','/trucks',{...truckBody,name:'Changed operation'},access);assert.equal(conflict.status,409);assert.equal(conflict.body.error.code,'TRUCK_CREATE_OPERATION_CONFLICT');
      const deniedVerify=await request('POST','/trucks/'+saved.body.id+'/verify',{expectedRevision:99},access);assert.equal(deniedVerify.status,409);
      const verified=await request('POST','/trucks/'+saved.body.id+'/verify',{expectedRevision:saved.body.revision},access);assert.equal(verified.status,200);assert.equal(verified.body.verifiedRevision,verified.body.revision);assert.equal(verified.body.verificationState,'VERIFIED');assert(verified.body.verifiedAt);assert(verified.body.isDefault);
      const routeInput={origin:{lat:40,lng:-120},destination:{lat:40,lng:-119.999},viaStops:[],truck:truckBody,truckProfileId:saved.body.id,truckRevision:verified.body.revision,routeMode:'fastest',alternatives:0};
      const route=await request('POST','/routing/truck-route',routeInput,access);assert.equal(route.status,503);assert.equal(route.body.error.code,'TRIMBLE_API_KEY_MISSING');assert.equal(route.body.truckSafe,false);
      const edited=await request('PATCH','/trucks/'+saved.body.id,{...truckBody,name:'Edited',expectedRevision:verified.body.revision},access);assert.equal(edited.status,200);assert.equal(edited.body.revision,verified.body.revision+1);assert.equal(edited.body.verifiedRevision,null);assert.equal(edited.body.verifiedAt,null);assert.equal(edited.body.isDefault,false);
      const stale=await request('POST','/routing/truck-route',routeInput,access);assert.equal(stale.status,409);assert.equal(stale.body.error.code,'TRUCK_PROFILE_CHANGED');
      assert.equal((await request('POST','/routing/truck-route',{},access)).status,400);
      for(const path of ['/routing/compare','/routing/traffic-preview'])assert.equal((await request('POST',path,routeInput,access)).status,410);
      for(const category of ['cat_scale','truck_repair','truck_stop']){const pois=await request('GET','/places/search?category='+category+'&lat=40&lng=-120&limit=30',undefined,access);assert.equal(pois.status,503);assert.equal(pois.body.error.code,'POI_PROVIDER_NOT_CONFIGURED');}
      const corridor={route:[routeInput.origin,routeInput.destination],currentLocation:{lat:40,lng:-120,accuracy:4,timestamp:Date.now()}};
      const poiCorridor=await request('POST','/places/corridor',{category:'truck_stop',...corridor},access);assert.equal(poiCorridor.status,503);assert.equal(poiCorridor.body.error.code,'POI_PROVIDER_NOT_CONFIGURED');
      for(const kind of ['restrictions','road-events','cameras','parking','fuel','weigh-stations']){const response=await request('POST','/safety/'+kind+'/corridor',corridor,access);assert.equal(response.status,200);assert(Array.isArray(response.body.items));}
      const weather=await request('POST','/weather/route',corridor,access);assert.equal(weather.status,200);assert(weather.body.items.every(item=>item.status==='UNAVAILABLE'));
      const hos=await request('GET','/eld/hos/current',undefined,access);assert.equal(hos.status,200);assert.equal(hos.body.status,'UNKNOWN');assert.equal(typeof hos.body.reason,'string');
      const plan = {
        createOperationId: crypto.randomUUID(),
        name: 'Synthetic HTTP plan',
        origin: { id: 'o', name: 'Origin', lat: 40, lng: -120 },
        destination: { id: 'd', name: 'Destination', lat: 41, lng: -120 },
        stops: [],
      };
      const trip = await request('POST', '/trips', plan, access);
      assert.equal(trip.status, 201);
      assert.equal(
        (await request('GET', '/trips', undefined, b.body.accessToken)).body
          .items.length,
        0,
      );
      assert.equal(
        (
          await request(
            'PATCH',
            '/trips/' + trip.body.id + '/status',
            { expectedRevision: 1, status: 'CANCELLED' },
            b.body.accessToken,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            'PATCH',
            '/trips/' + trip.body.id + '/status',
            { expectedRevision: 99, status: 'CANCELLED' },
            access,
          )
        ).status,
        409,
      );
      const doc = await request(
        'POST',
        '/documents',
        {
          createOperationId: crypto.randomUUID(),
          type: 'CDL',
          fileName: 'Synthetic label',
        },
        access,
      );
      assert.equal(doc.status, 201);
      assert.equal(doc.body.fileAvailable, false);
      assert.equal('fileUrl' in doc.body, false);
      assert.equal(
        (await request('GET', '/documents', undefined, b.body.accessToken)).body
          .items.length,
        0,
      );
      assert.equal(
        (
          await request(
            'PATCH',
            '/documents/' + doc.body.id,
            {
              expectedRevision: 1,
              metadata: { type: 'CDL', fileName: 'Other' },
            },
            b.body.accessToken,
          )
        ).status,
        404,
      );
      assert.equal(
        (await request('POST', '/documents/upload', {}, access)).status,
        503,
      );
      assert.equal(
        (
          await request(
            'POST',
            '/documents',
            {
              createOperationId: crypto.randomUUID(),
              type: 'CDL',
              fileName: 'Synthetic label',
              fileUrl: 'https://public.invalid/secret',
              userId: b.body.user.id,
            },
            access,
          )
        ).status,
        400,
      );
      const billing = await request(
        'POST',
        '/billing/webhook',
        { type: 'payment_succeeded', paid: true },
        access,
      );
      assert.equal(billing.status, 503);
      assert.equal(billing.body.error.code, 'BILLING_DISABLED');
      const badChange = await request(
        'POST',
        '/auth/password/change',
        {
          currentPassword: 'Wrong synthetic',
          password: 'Replacement synthetic password',
        },
        access,
      );
      assert.equal(badChange.status, 400);
      assert.equal(
        (
          await request(
            'POST',
            '/auth/password/change',
            {
              currentPassword: password,
              password: 'Replacement synthetic password',
            },
            access,
          )
        ).status,
        204,
      );
      assert.equal(
        (await request('GET', '/me', undefined, access)).status,
        401,
      );
      assert.equal(
        (
          await request('POST', '/auth/refresh', {
            refreshToken: login.body.refreshToken,
          })
        ).status,
        401,
      );
      assert.equal(
        (await request('POST', '/auth/login', { email, password })).status,
        401,
      );
      const changed = await request('POST', '/auth/login', {
        email,
        password: 'Replacement synthetic password',
      });
      assert.equal(changed.status, 200);
      assert.equal(
        (
          await request('POST', '/auth/logout', {
            refreshToken: changed.body.refreshToken,
          })
        ).status,
        204,
      );
      assert.equal(
        (await request('GET', '/me', undefined, changed.body.accessToken))
          .status,
        401,
      );
      // Synthetic fixture only: exercise the real Admin router and session invalidation.
      await db.user.update({where:{id:b.body.user.id},data:{role:'ADMIN'}});
      const staff=await request('POST','/auth/login',{email:b.body.user.email,password});assert.equal(staff.status,200);
      const reset=await db.passwordResetToken.create({data:{userId:b.body.user.id,tokenHash:crypto.randomBytes(32).toString('hex'),expiresAt:new Date(Date.now()+60000)}});
      const deniedPassword=await request('PATCH','/admin/account',{currentPassword:'Incorrect synthetic',newPassword:'New synthetic staff password'},staff.body.accessToken);assert.equal(deniedPassword.status,400);
      const staffChanged=await request('PATCH','/admin/account',{currentPassword:password,newPassword:'New synthetic staff password'},staff.body.accessToken);assert.equal(staffChanged.status,200);assert.equal(staffChanged.body.passwordChanged,true);
      assert((await db.passwordResetToken.findUniqueOrThrow({where:{id:reset.id}})).usedAt);
      assert.equal((await request('GET','/me',undefined,staff.body.accessToken)).status,401);
      const audit=await db.adminAuditLog.findFirstOrThrow({where:{actorUserId:b.body.user.id,action:'ADMIN_ACCOUNT_UPDATED'}});
      assert.deepEqual(Object.keys(audit.metadataJson).sort(),['emailChanged','nameChanged','passwordChanged']);
      const activeAdmin=await request('POST','/auth/login',{email:b.body.user.email,password:'New synthetic staff password'});assert.equal(activeAdmin.status,200);
      const logs=await request('GET','/admin/operations/audit',undefined,activeAdmin.body.accessToken);assert.equal(logs.status,200);assert(logs.body.items.length>0);assert(logs.body.items.every((row:any)=>!('metadataJson' in row)));
      await db.user.update({where:{id:b.body.user.id},data:{disabledAt:new Date()}});
      assert.equal((await request('GET','/me',undefined,activeAdmin.body.accessToken)).status,401);
    } finally {
      child.kill();
      await done;
      await disconnectDatabase();
    }
  },
);
