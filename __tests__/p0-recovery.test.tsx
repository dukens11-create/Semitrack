import React from 'react';
import {act,create, type ReactTestRenderer} from 'react-test-renderer';
import {AppErrorBoundary} from '../src/components/AppErrorBoundary';
import {LocationService, type LocationProvider} from '../src/services/location/LocationService';
import {TruckProfileStore} from '../src/features/truckProfile/TruckProfileStore';
import type {ApiClient} from '../src/services/api/ApiClient';
import {truck} from './fixtures';
test('render exceptions show fixed recovery copy without technical details',async()=>{
 const original=console.error;console.error=jest.fn();const warn=jest.spyOn(console,'warn').mockImplementation(()=>{});const stop=jest.fn();
 function Broken():React.ReactNode {throw new Error('DATABASE_URL private stack secret');}
 let screen:ReactTestRenderer|undefined;
 try{await act(async()=>{screen=create(<AppErrorBoundary onFailure={stop}><Broken/></AppErrorBoundary>);});const content=JSON.stringify(screen!.toJSON());expect(content).toContain('needs to recover');expect(content).not.toMatch(/DATABASE_URL|secret|stack/);expect(stop).toHaveBeenCalledTimes(1);expect(JSON.stringify(warn.mock.calls)).not.toMatch(/DATABASE_URL|secret|stack/);}finally{if(screen)await act(async()=>screen!.unmount());console.error=original;warn.mockRestore();}
});
test('native error text never enters driver location state',async()=>{
 let emit:(s:string)=>void=()=>{};const provider:LocationProvider={permissionStatus:async()=>'granted',permission:async()=>'granted',start:async()=>{},stop:async()=>{},subscribe:(_fix,error)=>{emit=error;return()=>{};}};
 const location=new LocationService(provider);await location.start();emit('native stack password precise coordinates');expect(location.getSnapshot().error).not.toMatch(/stack|password|coordinates/);expect(location.getSnapshot().fix).toBeNull();await location.stop();
});
test('failed profile refresh invalidates active confirmation and route',async()=>{
 const profile={...truck,lengthFt:53};let fail=false;const request=jest.fn(async(method:string)=>{if(fail)throw new Error('offline');return method==='GET'?{items:[profile]}:undefined;});const clear=jest.fn();const store=new TruckProfileStore({request} as unknown as ApiClient,clear);
 await store.load();await store.select(profile);expect(store.getSnapshot().selected?.id).toBe(profile.id);fail=true;await expect(store.load()).rejects.toThrow();expect(store.getSnapshot().selected).toBeNull();expect(clear).toHaveBeenCalled();
});
