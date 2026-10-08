import { ApiClient, ApiError } from '../src/services/api/ApiClient';
import { AuthStore } from '../src/features/auth/AuthStore';
import { safeDriverError } from '../src/errors/driverErrors';
import { MemoryVault, tokens, reply, deferred } from './fixtures';
afterEach(() => jest.useRealTimers());
test.each([400,401,403,404,409,429,500,503])('HTTP %i has a safe message and no automatic mutation retry', async status => {
  const transport = jest.fn(async()=>reply({error:{code:'UNKNOWN',message:'DATABASE_URL password stack secret'}},status));
  const api = new ApiClient('https://api.example.test',new MemoryVault(),transport);
  let caught: unknown;
  try { await api.request('POST','/trucks',{}); } catch(error) { caught=error; }
  expect(caught).toBeInstanceOf(ApiError);
  expect(safeDriverError(caught)).not.toMatch(/DATABASE_URL|password|stack|secret/);
  expect((caught as Error).message).not.toMatch(/DATABASE_URL|password|stack|secret/);
  expect(transport).toHaveBeenCalledTimes(1);
});
test('cancelled request is never dispatched', async()=>{
  const transport=jest.fn(); const c=new AbortController();c.abort();
  const api=new ApiClient('https://api.example.test',new MemoryVault(),transport);
  await expect(api.request('POST','/routing/truck-route',{},c.signal)).rejects.toMatchObject({code:'REQUEST_CANCELLED'});
  expect(transport).not.toHaveBeenCalled();
});
test('deadline covers response body and clears its timer',async()=>{
  jest.useFakeTimers({doNotFake:['nextTick','queueMicrotask','setImmediate']});
  const started=deferred<void>();
  const transport=jest.fn(async(_url, init)=>({status:200,ok:true,text:()=>new Promise((_yes,no)=>{init!.signal!.addEventListener('abort',()=>no(new Error('private transport details')));started.resolve();})} as unknown as Response));
  const api=new ApiClient('https://api.example.test',new MemoryVault(),transport);
  const request=api.request('GET','/me');const check=request.catch(error=>error);
  await started.promise;await jest.advanceTimersByTimeAsync(20001);expect(await check).toMatchObject({code:'REQUEST_TIMEOUT'});expect(jest.getTimerCount()).toBe(0);
});
test('malformed refresh retains credentials and returns controlled error',async()=>{
  const vault=new MemoryVault(tokens);const transport=jest.fn().mockResolvedValueOnce(reply({},401)).mockResolvedValueOnce(reply({bad:'secret'}));
  await expect(new ApiClient('https://api.example.test',vault,transport).request('GET','/me')).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  expect(vault.value).toEqual(tokens);
});
test('logout sends captured authorization after local secure clear',async()=>{
  const vault=new MemoryVault(tokens); const transport=jest.fn(async()=>reply(undefined,204));
  await new AuthStore(new ApiClient('https://api.example.test',vault,transport),vault).logout();
  expect(vault.value).toBeNull();expect(transport).toHaveBeenCalledWith('https://api.example.test/auth/logout',expect.objectContaining({headers:expect.objectContaining({Authorization:'Bearer '+tokens.accessToken}),body:JSON.stringify({refreshToken:tokens.refreshToken})}));
});
test('session change while vault read is pending cannot send old credentials',async()=>{
  const pending=deferred<typeof tokens|null>();const transport=jest.fn();const vault={read:()=>pending.promise,write:async()=>{},clear:async()=>{}};
  const api=new ApiClient('https://api.example.test',vault,transport);const request=api.request('GET','/me');api.invalidateSession();pending.resolve(tokens);
  await expect(request).rejects.toMatchObject({code:'SESSION_CHANGED'});expect(transport).not.toHaveBeenCalled();
});

test('deadline still rejects a transport that ignores abort',async()=>{jest.useFakeTimers();const api=new ApiClient('https://api.example.test',new MemoryVault(),jest.fn(()=>new Promise(()=>{})));const result=api.request('GET','/me').catch(error=>error);await jest.advanceTimersByTimeAsync(20001);expect(await result).toMatchObject({code:'REQUEST_TIMEOUT'});expect(jest.getTimerCount()).toBe(0);});
