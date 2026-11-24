import { TruckProfileStore } from '../src/features/truckProfile/TruckProfileStore';
import { ApiError, type ApiClient } from '../src/services/api/ApiClient';
import { truck } from './fixtures';
const valid = {...truck,lengthFt:53,hazmatEnabled:false,hazardousGoods:[],avoidFerries:false,avoidResidential:false,avoidDirtRoads:false,weightPerAxleLbs:null};
test('timeout blocks navigation until the same confirmed profile is recovered',async()=>{
 const request=jest.fn().mockResolvedValue({items:[valid]});
 const store=new TruckProfileStore({request} as unknown as ApiClient,jest.fn());
 await store.load();expect(store.getSnapshot().selected?.id).toBe(valid.id);
 request.mockRejectedValueOnce(new ApiError('REQUEST_TIMEOUT','timeout'));
 await expect(store.load()).rejects.toThrow();expect(store.getSnapshot().selected).toBeNull();
 await store.load();expect(store.getSnapshot().selected?.id).toBe(valid.id);
});
test('recovery never restores a profile that changed while disconnected',async()=>{
 const request=jest.fn().mockResolvedValue({items:[valid]});
 const store=new TruckProfileStore({request} as unknown as ApiClient,jest.fn());
 await store.load();request.mockRejectedValueOnce(new ApiError('REQUEST_TIMEOUT','timeout'));
 await expect(store.load()).rejects.toThrow();
 request.mockResolvedValue({items:[{...valid,heightFt:13,revision:(valid.revision??1)+1}]});
 await store.load();expect(store.getSnapshot().selected).toBeNull();
});
test('logout clears recovery identity',async()=>{
 const request=jest.fn().mockResolvedValue({items:[valid]});
 const store=new TruckProfileStore({request} as unknown as ApiClient,jest.fn());
 await store.load();request.mockRejectedValueOnce(new ApiError('REQUEST_TIMEOUT','timeout'));
 await expect(store.load()).rejects.toThrow();store.clear();
 request.mockResolvedValue({items:[]});await store.load();
 expect(store.getSnapshot().selected).toBeNull();expect(store.getSnapshot().profiles).toEqual([]);
});
