import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {HybridNavigation} from '../src/features/map/HybridNavigation';
import {DriverButton} from '../src/components/DriverUI';
import type {Services} from '../src/app/services';
const mockHost = {resumeEngineTrip:jest.fn(),hasEngineTrip:jest.fn(), reviewEngineTripProfile:jest.fn(), openEngineTrip:jest.fn(), endEngineTrip:jest.fn(), returnFromEngineTrip:jest.fn()};
const mockAlert = jest.fn();
const mockRefresh = jest.fn();
let mockReady = true;
jest.mock('../src/services/copilot/CoPilotHost',()=>({coPilotHost:()=>mockHost}));
jest.mock('../src/services/copilot/CopilotProvider',()=>({useCopilotState:()=>({readyToAddStops:mockReady,initialized:true,mapsReady:false,operation:'installed-licensed-maps'}),useCopilotSetup:()=>({refresh:mockRefresh,downloadStatus:'Downloading offline map…'})}));
jest.mock('../src/screens/TruckProfileScreen',()=>({TruckProfileScreen:()=>null}));
jest.mock('../src/features/weather/WeatherStatus',()=>({WeatherStatus:()=>null}));
jest.mock('../src/features/map/EngineMapboxProof',()=>({EngineMapboxProof:()=>null}));
jest.mock('../src/components/ThemedAlert',()=>({Alert:{alert:(...args:unknown[])=>mockAlert(...args)}}));
jest.mock('../src/hooks/useStore',()=>({useStore:()=>({fix:null})}));
let tree:ReactTestRenderer;
const closed=jest.fn();
const getFreshFix=jest.fn();
const clear=jest.fn();
const services={routes:{clear},trucks:{getSnapshot:()=>({selected:null})},location:{getFreshFix},environment:{mapboxToken:'pk.test'},poi:{}} as unknown as Services;
async function press(title:string){await act(async()=>{await tree.root.findAllByType(DriverButton).find(x=>x.props.title===title)!.props.onPress();});}
beforeEach(async()=>{jest.clearAllMocks();mockReady=true;mockHost.hasEngineTrip.mockResolvedValue(false);mockHost.reviewEngineTripProfile.mockResolvedValue({ticket:'review',name:'Truck',heightInches:162,widthInches:102,lengthInches:636,weightLbs:80000});mockHost.endEngineTrip.mockResolvedValue(undefined);getFreshFix.mockReturnValue(null);await act(async()=>{tree=create(<HybridNavigation services={services} plan={{stops:[],destination:{id:'d',name:'Destination',lat:39,lng:-119}}} onClose={closed}/>);});});
afterEach(async()=>{await act(async()=>tree.unmount());});
test('missing verified truck blocks native start with an actionable error',async()=>{await press('Start / Resume Navigation');expect(mockHost.openEngineTrip).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('save and verify');});
test('failed engine stop never closes the live session',async()=>{mockHost.endEngineTrip.mockRejectedValue(new Error('Stop unconfirmed'));await press('End Route');await act(async()=>{mockAlert.mock.calls[0][2][1].onPress();});expect(mockHost.endEngineTrip).toHaveBeenCalled();expect(closed).not.toHaveBeenCalled();});
test('existing trip prevents return to planner',async()=>{mockHost.hasEngineTrip.mockResolvedValue(true);await press('Back to planner');expect(closed).not.toHaveBeenCalled();});
test('confirmed engine stop permits returning to planner',async()=>{await press('End Route');await act(async()=>{mockAlert.mock.calls[0][2][1].onPress();});expect(closed).toHaveBeenCalledTimes(1);});

test('blocked navigation exposes readiness refresh and map download progress',async()=>{mockReady=false;await act(async()=>{tree.update(<HybridNavigation services={services} plan={{stops:[],destination:{id:'d',name:'Destination',lat:39,lng:-119}}} onClose={closed}/>);});expect(JSON.stringify(tree.toJSON())).toContain('Downloading offline map');await press('Check readiness');expect(mockRefresh).toHaveBeenCalledTimes(1);expect(mockHost.openEngineTrip).not.toHaveBeenCalled();});

test('truck editor does not require readyToAddStops',async()=>{mockReady=false;await press('Truck settings');expect(JSON.stringify(tree.toJSON())).toContain('Back to SemiTraX controls');});
