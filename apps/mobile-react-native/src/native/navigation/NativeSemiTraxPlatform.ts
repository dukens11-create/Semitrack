import type { TurboModule, CodegenTypes } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
export interface Spec extends TurboModule {
  createOperationId(): Promise<string>;
  guidanceCommand(command: string, payload: string): Promise<string>;
  locationPermissionStatus(): Promise<string>;
  requestLocationPermission(background: boolean): Promise<string>;
  startLocation(background: boolean): Promise<void>;
  stopLocation(): Promise<void>;
  readonly onLocation: CodegenTypes.EventEmitter<string>;
  readonly onLocationError: CodegenTypes.EventEmitter<string>;
}
export default TurboModuleRegistry.get<Spec>('NativeSemiTraxPlatform');
