import {ApiClient,ApiError} from '../src/services/api/ApiClient';
import {capabilitiesSchema,planningStatus} from '../src/features/routing/capabilities';
const vault={read:jest.fn(async()=>null),write:jest.fn(),clear:jest.fn(async()=>{})};
const fixture=(state='PLANNING_UNVERIFIED',status='DEGRADED',validUntil:string|null=null)=>capabilitiesSchema.parse({contractVersion:'rn-p0-v1',truckRouting:{provider:'Trimble',state,status,validUntil,requestAllowed:true,verifiedProfileRequired:true},turnByTurn:{available:false,state:'UNAVAILABLE',licenseStatus:'UNVERIFIED'}});
test.each([400,401,403,404,409,422,429,500,502,503])('HTTP %i survives an invalid proxy error body without exposing its text',async status=>{
 const transport=jest.fn(async()=>({ok:false,status,text:async()=>'<html>private upstream details</html>'})) as unknown as typeof fetch;
 const api=new ApiClient('https://example.invalid',vault,transport);
 try{await api.request('GET','/me');throw Error('must reject');}catch(e){expect(e).toBeInstanceOf(ApiError);expect((e as ApiError).status).toBe(status);expect((e as Error).message).not.toContain('private upstream');if(status===401)expect((e as Error).message).toContain('sign in');if(status===502)expect((e as ApiError).code).toBe('PROVIDER_UNAVAILABLE');}
});
test('capability data never turns configuration alone into planning success',()=>{
 expect(planningStatus({verified:true,phase:'idle',capabilities:fixture()})).toContain('unverified');
 expect(planningStatus({verified:true,phase:'idle',capabilities:fixture('PLANNING_AVAILABLE','OPERATIONAL','2026-09-15T12:00:00Z'),now:Date.parse('2026-09-15T12:01:00Z')})).toContain('unverified');
 expect(planningStatus({verified:true,phase:'idle',capabilities:fixture('PLANNING_AVAILABLE','OPERATIONAL','2026-09-15T12:00:00Z'),now:Date.parse('2026-09-15T11:59:00Z')})).toContain('planning available');
});
test('planning distinguishes review, configuration, provider failure and not-started guidance',()=>{
 expect(planningStatus({verified:false,phase:'idle'})).toContain('verification required');
 expect(planningStatus({verified:true,phase:'error',errorCode:'TRUCK_PROFILE_CHANGED'})).toContain('profile changed');
 expect(planningStatus({verified:true,phase:'error',errorCode:'TRIMBLE_AUTHORIZATION_FAILED'})).toContain('configuration');
 expect(planningStatus({verified:true,phase:'error',errorCode:'TRIMBLE_NETWORK_ERROR'})).toContain('temporarily unavailable');
 expect(planningStatus({verified:true,phase:'preview'})).toContain('Navigation not started');
 expect(planningStatus({verified:true,phase:'calculating'})).toContain('Calculating');
 expect(planningStatus({verified:true,phase:'error'})).toContain('calculation failed');
});
test('capability parsing rejects non-Trimble and claimed native or license success',()=>{
 const valid=fixture();expect(()=>capabilitiesSchema.parse({...valid,truckRouting:{...valid.truckRouting,provider:'HERE'}})).toThrow();
 expect(()=>capabilitiesSchema.parse({...valid,turnByTurn:{...valid.turnByTurn,available:true}})).toThrow();
});
