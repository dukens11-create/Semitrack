import * as Keychain from 'react-native-keychain';
import {SecureOfflineVault} from '../src/services/storage/SecureOfflineVault';
jest.mock('react-native-keychain',()=>({ACCESSIBLE:{WHEN_UNLOCKED_THIS_DEVICE_ONLY:'local-unlocked'},getGenericPassword:jest.fn(),setGenericPassword:jest.fn(),resetGenericPassword:jest.fn()}));
test('offline storage uses separate device-only unlocked keychain and propagates write failure',async()=>{
 const vault=new SecureOfflineVault();jest.mocked(Keychain.setGenericPassword).mockResolvedValueOnce({} as never).mockResolvedValueOnce(false);
 await vault.write('synthetic');expect(Keychain.setGenericPassword).toHaveBeenCalledWith('offline','synthetic',{service:'com.semitrax.app.offline-preferences',accessible:'local-unlocked'});
 await expect(vault.write('synthetic')).rejects.toThrow();await vault.clear();expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({service:'com.semitrax.app.offline-preferences',accessible:'local-unlocked'});
});

import {PendingDocumentCreates} from '../src/services/storage/PendingDocumentCreates';
test('deletion erases only owner pending document data and refuses late writes without touching other owner',async()=>{
 const data=new Map<string,string>();const pending=new PendingDocumentCreates({read:async owner=>data.get(owner)??null,write:async(owner,value)=>{data.set(owner,value);},clear:async owner=>{data.delete(owner);}});
 const body={createOperationId:'48f56d6a-2de4-4bd5-b4f8-ae77d415dd41',type:'GENERAL',fileName:'Private label',issuedOn:null,expiresOn:null,truckId:null};
 await pending.begin('deleted-owner',body);await pending.begin('other-owner',body);await pending.discardOwner('deleted-owner');await pending.discardOwner('deleted-owner');
 expect(data.has('deleted-owner')).toBe(false);expect(data.has('other-owner')).toBe(true);expect(await pending.read('deleted-owner')).toBeNull();
 await expect(pending.begin('deleted-owner',body)).rejects.toThrow('Account access removed');expect(await pending.read('other-owner')).toEqual(body);
});
