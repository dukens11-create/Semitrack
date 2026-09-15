#import "SemiTraxPlatform.h"
#import "SemiTrax-Swift.h"
@implementation SemiTraxPlatform {
  SemiTraxLocation *_location;
}
+ (NSString *)moduleName { return @"NativeSemiTraxPlatform"; }
+ (BOOL)requiresMainQueueSetup { return YES; }
- (instancetype)init {
  if ((self = [super init])) {
    _location = [SemiTraxLocation new];
    __weak SemiTraxPlatform *weakSelf = self;
    _location.onFix = ^(NSString *value) { [weakSelf emitOnLocation:value]; };
    _location.onError = ^(NSString *value) { [weakSelf emitOnLocationError:value]; };
  }
  return self;
}
- (void)createOperationId:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject { resolve([[NSUUID UUID] UUIDString].lowercaseString); }
- (void)guidanceCommand:(NSString *)command payload:(NSString *)payload resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSString *result = [self->_location guidanceCommand:command payload:payload];
    if (result) resolve(result); else reject(@"NATIVE_TRUCK_GUIDANCE_NOT_CONFIGURED", @"Native commercial guidance is not configured.", nil);
  });
}
- (void)locationPermissionStatus:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{ resolve([self->_location permissionStatus]); });
}
- (void)requestLocationPermission:(BOOL)background resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{ [self->_location permission:background reply:^(NSString *state) { resolve(state); }]; });
}
- (void)startLocation:(BOOL)background resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSString *error = [self->_location start:background];
    if (error) reject(@"LOCATION_UNAVAILABLE", error, nil); else resolve(nil);
  });
}
- (void)stopLocation:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{ [self->_location stop]; resolve(nil); });
}
- (void)invalidate { dispatch_async(dispatch_get_main_queue(), ^{ [self->_location invalidate]; }); }
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeSemiTraxPlatformSpecJSI>(params);
}
@end

