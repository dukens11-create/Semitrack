import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {Text,TextInput,AppState,BackHandler} from 'react-native';
import {DeleteAccountPanel} from '../src/features/auth/DeleteAccountPanel';
import {OfflineAccountScreen} from '../src/screens/OfflineAccountScreen';
import {DriverAppearanceContext} from '../src/features/settings/DriverPreferences';
import {Alert} from '../src/components/ThemedAlert';
import {AuthStore} from '../src/features/auth/AuthStore';
import {Store} from '../src/state/Store';
import {deferred} from './fixtures';
let screen:ReactTestRenderer;
const button=(label:string)=>screen.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0]!;
const field=(label:string)=>screen.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel===label)!;
const content=()=>screen.root.findAllByType(Text).flatMap(n=>[n.props.children].flat(Infinity)).join('');
afterEach(async()=>{if(screen)await act(async()=>screen.unmount());jest.restoreAllMocks();jest.useRealTimers();});
test.each(['day','night'] as const)('deletion in %s requires password, typed confirmation and destructive dialog; cancel is inert',async mode=>{
 const remove=jest.fn(async()=>{}),dialog=jest.spyOn(Alert,'alert').mockImplementation(()=>{});
 await act(async()=>{screen=create(<DriverAppearanceContext.Provider value={mode}><DeleteAccountPanel auth={{deleteAccount:remove} as unknown as AuthStore}/></DriverAppearanceContext.Provider>);});
 expect(button('Delete my account').props.disabled).toBe(true);expect(field('Current password for deletion').props.secureTextEntry).toBe(true);
 await act(async()=>{field('Current password for deletion').props.onChangeText('PRIVATE_PASSWORD');field('Type DELETE MY ACCOUNT').props.onChangeText('DELETE MY ACCOUNT');});
 expect(button('Delete my account').props.disabled).toBe(false);await act(async()=>button('Delete my account').props.onPress());
 expect(remove).not.toHaveBeenCalled();expect(dialog.mock.calls[0]![2]![0]!.style).toBe('cancel');
 expect(content()).toContain('retained for policy review');expect(content()).not.toContain('PRIVATE_PASSWORD');
 await act(async()=>dialog.mock.calls[0]![2]![1]!.onPress?.());expect(remove).toHaveBeenCalledWith('PRIVATE_PASSWORD','DELETE MY ACCOUNT');
});
test('deletion duplicate confirmation is suppressed; failure is sanitized and clears password',async()=>{
 const pending=deferred<void>(),remove=jest.fn(()=>pending.promise),dialog=jest.spyOn(Alert,'alert').mockImplementation(()=>{});
 await act(async()=>{screen=create(<DeleteAccountPanel auth={{deleteAccount:remove} as unknown as AuthStore}/>);});
 await act(async()=>{field('Current password for deletion').props.onChangeText('PRIVATE');field('Type DELETE MY ACCOUNT').props.onChangeText('DELETE MY ACCOUNT');});
 await act(async()=>button('Delete my account').props.onPress());const confirm=dialog.mock.calls[0]![2]![1]!.onPress!;
 await act(async()=>{confirm();confirm();});expect(remove).toHaveBeenCalledTimes(1);
 await act(async()=>pending.reject(Error('PRIVATE_TOKEN raw server data')));expect(content()).not.toContain('PRIVATE_TOKEN');expect(content()).toContain('Deletion could not be confirmed');expect(field('Current password for deletion').props.value).toBe('');
});
test.each(['day','night'] as const)('offline screen %s has read-only preferences, lifecycle expiry checks and working Back',async mode=>{
 jest.useFakeTimers();const state={status:'offline',user:null,offline:{verifiedAt:Date.now(),expiresAt:Date.now()+1000,preferencesSavedAt:Date.now(),preferences:{units:'metric',temperatureUnit:'C',dayNightMode:'day'}}};
 const auth=Object.assign(new Store(state),{closeOffline:jest.fn(),recheckOffline:jest.fn(async()=>{}),restore:jest.fn(async()=>{}),logout:jest.fn(async()=>{})});
 const lifecycle=jest.spyOn(AppState,'addEventListener'),back=jest.spyOn(BackHandler,'addEventListener');
 await act(async()=>{screen=create(<DriverAppearanceContext.Provider value={mode}><OfflineAccountScreen auth={auth as unknown as AuthStore}/></DriverAppearanceContext.Provider>);});
 expect(content()).toContain('Read-only saved preferences');expect(content()).toContain('Kilometers');expect(screen.root.findAllByType(TextInput)).toHaveLength(0);
 await act(async()=>{lifecycle.mock.calls[lifecycle.mock.calls.length-1]![1]('active');jest.advanceTimersByTime(1000);});expect(auth.recheckOffline).toHaveBeenCalledTimes(2);
 back.mock.calls[back.mock.calls.length-1]![1]();expect(auth.closeOffline).toHaveBeenCalledTimes(1);expect(auth.restore).not.toHaveBeenCalled();
});

