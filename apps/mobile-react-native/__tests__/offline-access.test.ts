import {OfflineAccess, OFFLINE_VIEW_MAX_AGE_MS, type OfflineRecordVault} from '../src/features/offline/OfflineAccess';
import {AuthStore} from '../src/features/auth/AuthStore';
import {ApiClient} from '../src/services/api/ApiClient';
import {SettingsService, type Settings} from '../src/features/settings/SettingsService';
import {MemoryVault,tokens,user,reply,deferred} from './fixtures';
class RecordVault implements OfflineRecordVault {
  value:string|null=null;
  async read(){return this.value;}
  async write(value:string){this.value=value;}
  async clear(){this.value=null;}
}
const settings:Settings={voiceEnabled:true,voiceMuted:false,voiceLocale:'en-US',trafficReroute:true,units:'metric',dayNightMode:'day',settingsJson:{rnTemperatureUnit:'C',recentAddress:'PRIVATE ADDRESS',token:'PRIVATE TOKEN'}};
function setup(){const storage=new RecordVault(),session=new MemoryVault(tokens);let now=100000;const offline=new OfflineAccess(storage,session,()=>now);return {storage,session,offline,setNow:(n:number)=>{now=n;}};}
test('only minimal preferences retained in bound vault; UI receives no identity/session/locations',async()=>{
 const {storage,offline}=setup();await offline.confirm(user.id);await offline.savePreferences(user.id,settings);
 const raw=storage.value!;expect(raw).not.toContain('PRIVATE');expect(raw).not.toContain('voiceLocale');
 const view=await offline.read();expect(view?.preferences).toEqual({units:'metric',dayNightMode:'day',temperatureUnit:'C'});
 expect(JSON.stringify(view)).not.toContain(user.id);expect(JSON.stringify(view)).not.toContain(tokens.refreshToken);
});
test.each(['expired','future','changed session','missing session','corrupt','extra fields','locked'])('offline cache fails closed for %s',async kind=>{
 const s=setup();await s.offline.confirm(user.id);
 if(kind==='expired')s.setNow(100000+OFFLINE_VIEW_MAX_AGE_MS);
 if(kind==='future')s.setNow(99999);
 if(kind==='changed session')s.session.value={...tokens,refreshToken:'another-session'};
 if(kind==='missing session')await s.session.clear();
 if(kind==='corrupt')s.storage.value='{';
 if(kind==='extra fields')s.storage.value=JSON.stringify({...JSON.parse(s.storage.value!),route:{truckSafe:true}});
 if(kind==='locked')s.storage.read=async()=>{throw Error('locked');};
 expect(await s.offline.read()).toBeNull();
});
test('logout clears pending cache writes and a different owner never inherits preferences',async()=>{
 const s=setup();await s.offline.confirm(user.id);await s.offline.savePreferences(user.id,settings);
 await s.offline.confirm('another-user');expect((await s.offline.read())?.preferences).toBeNull();
 await Promise.all([s.offline.savePreferences('another-user',settings),s.offline.clear()]);expect(s.storage.value).toBeNull();
});
test('cold offline startup requires explicit read-only entry, expires and never grants authenticated user',async()=>{
 const s=setup();const transport=jest.fn().mockResolvedValueOnce(reply(user)).mockRejectedValue(new Error('offline'));
 const auth=new AuthStore(new ApiClient('https://api.example.test',s.session,transport),s.session,s.offline);
 await auth.restore();await s.offline.savePreferences(user.id,settings);
 await auth.restore();expect(auth.getSnapshot().status).toBe('unavailable');await auth.openOffline();
 expect(auth.getSnapshot()).toMatchObject({status:'offline',user:null});expect(transport).toHaveBeenCalledTimes(2);
 s.setNow(100000+OFFLINE_VIEW_MAX_AGE_MS);await auth.recheckOffline();expect(auth.getSnapshot().status).toBe('unavailable');
 await auth.logout();expect(s.storage.value).toBeNull();expect(s.session.value).toBeNull();
});
test.each([401,403,500,200])('HTTP %s or malformed account never opens offline fallback',async status=>{
 const s=setup();await s.offline.confirm(user.id);const auth=new AuthStore(new ApiClient('https://api.example.test',s.session,jest.fn(async()=>reply({},status))),s.session,s.offline);
 await auth.restore();expect(auth.getSnapshot().offline).toBeUndefined();await auth.openOffline();expect(auth.getSnapshot().status).not.toBe('offline');
});
test('settings cache only updates after server acknowledgement; failed save retains old preferences',async()=>{
 const retained=jest.fn(async()=>{});const request=jest.fn().mockResolvedValueOnce(settings).mockRejectedValueOnce(new Error('offline'));
 const service=new SettingsService({request} as unknown as ApiClient,undefined,retained);
 await service.load();await expect(service.save({...settings,units:'imperial'})).rejects.toThrow();expect(retained).toHaveBeenCalledTimes(1);expect(service.getSnapshot().settings?.units).toBe('metric');
});
test('account clear during settings cache write cannot publish stale preferences',async()=>{
 const wait=deferred<void>();const retained=jest.fn(()=>wait.promise);
 const service=new SettingsService({request:async()=>settings} as unknown as ApiClient,undefined,retained);
 const load=service.load();await Promise.resolve();await Promise.resolve();service.clear();wait.resolve();await load;expect(service.getSnapshot().settings).toBeNull();
});
test('deletion requires signed-in confirmation; confirmed receipt clears tokens and offline snapshot',async()=>{
 const s=setup();const transport=jest.fn(async(url:RequestInfo)=>reply(String(url).endsWith('/me')?user:{}));
 const auth=new AuthStore(new ApiClient('https://api.example.test',s.session,transport),s.session,s.offline);
 await expect(auth.deleteAccount('password','DELETE MY ACCOUNT')).rejects.toThrow();await auth.restore();
 await expect(auth.deleteAccount('password','wrong')).rejects.toThrow();transport.mockResolvedValue(reply({deleted:true}));
 await auth.deleteAccount('password','DELETE MY ACCOUNT');expect(auth.getSnapshot().status).toBe('signedOut');expect(s.session.value).toBeNull();expect(s.storage.value).toBeNull();
 expect(transport).toHaveBeenCalledWith('https://api.example.test/me',expect.objectContaining({method:'DELETE',body:JSON.stringify({currentPassword:'password',confirmation:'DELETE MY ACCOUNT'})}));
});
test('unconfirmed deletion response does not claim success or discard session',async()=>{
 const s=setup();const transport=jest.fn().mockResolvedValueOnce(reply(user)).mockResolvedValue(reply({deleted:false}));
 const auth=new AuthStore(new ApiClient('https://api.example.test',s.session,transport),s.session,s.offline);await auth.restore();
 await expect(auth.deleteAccount('password','DELETE MY ACCOUNT')).rejects.toThrow();expect(auth.getSnapshot().status).toBe('signedIn');expect(s.session.value).toEqual(tokens);
});

test('a deletion response from an older session cannot sign out the next account',async()=>{
 const s=setup(),pending=deferred<Response>();
 const transport=jest.fn().mockResolvedValueOnce(reply(user)).mockImplementationOnce(()=>pending.promise).mockResolvedValue(reply({...tokens,user:{...user,id:'next-account'}}));
 const auth=new AuthStore(new ApiClient('https://api.example.test',s.session,transport),s.session,s.offline);await auth.restore();
 const deletion=auth.deleteAccount('password','DELETE MY ACCOUNT');const outcome=deletion.catch(error=>error);await Promise.resolve();await Promise.resolve();
 await auth.authenticate('next@example.test','password');pending.resolve(reply({deleted:true}));expect(await outcome).toMatchObject({code:'SESSION_CHANGED'});
 expect(auth.getSnapshot().user?.id).toBe('next-account');expect(auth.getSnapshot().status).toBe('signedIn');
});



test('confirmed deletion clears only its personal device data; cleanup failure still revokes local access',async()=>{
 const s=setup(),erase=jest.fn(async()=>{throw Error('device vault locked');});
 const transport=jest.fn().mockResolvedValueOnce(reply(user)).mockResolvedValue(reply({deleted:true}));
 const auth=new AuthStore(new ApiClient('https://api.example.test',s.session,transport),s.session,s.offline,erase);await auth.restore();
 await expect(auth.deleteAccount('password','DELETE MY ACCOUNT')).rejects.toThrow('device vault locked');
 expect(erase).toHaveBeenCalledWith(user.id);expect(s.session.value).toBeNull();expect(s.storage.value).toBeNull();expect(auth.getSnapshot().status).toBe('signedOut');
});
