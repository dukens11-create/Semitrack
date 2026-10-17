import { NativeModules, Platform } from 'react-native';
import {readEnginePreference,writeEnginePreference} from '../src/services/copilot/EnginePreferences';
beforeEach(() => {Object.defineProperty(Platform,'OS',{configurable:true,value:'android'});NativeModules.GuidanceSettings={isSpeedAlertEnabled:jest.fn(async()=>true),setSpeedAlert:jest.fn(async()=>{})};});
test('reads actual setting',async()=>{expect(await readEnginePreference('speedAlert')).toBe(true);});
test('writes only succeed after matching readback',async()=>{await expect(writeEnginePreference('speedAlert',false)).rejects.toThrow('confirm');NativeModules.GuidanceSettings.isSpeedAlertEnabled.mockResolvedValue(false);expect(await writeEnginePreference('speedAlert',false)).toBe(false);});
test('rejects invalid readback and missing module',async()=>{NativeModules.GuidanceSettings.isSpeedAlertEnabled.mockResolvedValue('true');await expect(readEnginePreference('speedAlert')).rejects.toThrow();delete NativeModules.GuidanceMgr;await expect(readEnginePreference('nearTurn')).rejects.toThrow();});
