// Behavioral contract tests compile the actual handoff against a deterministic SDK double.
// This is not a licensed SDK/device acceptance test.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const root=path.resolve(__dirname,'..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hybrid-handoff-'));
const files={
 'com/alk/cpik/Coordinate.java':'package com.alk.cpik; public class Coordinate {public Coordinate(double a,double b){}}',
 'com/alk/cpik/GeocodeSearchType.java':'package com.alk.cpik; public enum GeocodeSearchType {BEST_MATCH}',
 'com/alk/cpik/Stop.java':'package com.alk.cpik; public class Stop {public final String id; public Stop(String x){id=x;} public String getID(){return id;} public boolean isVehicleRestricted(){return StopBuilder.restricted;}}',
 'com/alk/cpik/StopList.java':'package com.alk.cpik; public class StopList extends java.util.ArrayList<Stop> {}',
 'com/alk/cpik/StopBuilder.java':'package com.alk.cpik; public class StopBuilder {public static boolean restricted; String id; public static StopBuilder fromLatLon(Coordinate x){return new StopBuilder();} public StopBuilder setName(String x){return this;} public StopBuilder setID(String x){id=x;return this;} public StopList geocode(GeocodeSearchType t){StopList s=new StopList();s.add(new Stop(id));return s;}}',
 'com/alk/cpik/route/RouteEnums.java':'package com.alk.cpik.route; public class RouteEnums {public enum VehicleType {TRUCK_HEAVY_DUTY,CAR} public enum AddStopPurpose {NEW_TRIP} public enum RoutePreviewMode {NO_PREVIEW,PREVIEW_TRIP_MAP_NO_WIDGET}}',
 'com/alk/cpik/route/VehicleRoutingProfile.java':'package com.alk.cpik.route; public class VehicleRoutingProfile {public RouteEnums.VehicleType type=RouteEnums.VehicleType.TRUCK_HEAVY_DUTY; public String name="truck"; public VehicleRoutingProfileSource source=VehicleRoutingProfileSource.FLEET_PORTAL; public int restriction=1; public VehicleRoutingProfileSource getVehicleRoutingProfileSource(){return source;} public String toString(){return name+type+source+restriction;} public String getName(){return name;} public RouteEnums.VehicleType getVehicleType(){return type;} public boolean equals_RoutingFieldsOnly(VehicleRoutingProfile p){return name.equals(p.name)&&type==p.type&&restriction==p.restriction;}}',
 'com/alk/cpik/route/RouteListener.java':'package com.alk.cpik.route; import com.alk.cpik.*; public class RouteListener {public static RouteListener current; public static void registerListener(RouteListener l){current=l;} public static void unregisterListener(RouteListener l){current=null;} public void onStopsAdded(StopList s){} public void onStopsDeleted(StopList s){} public void onStartRouteCalculation(){} public void onCompleteRouteCalculation(){} public void onFailedRouteCalculation(int l,Stop s){}}',
 'com/alk/cpik/route/RouteMgr.java':'package com.alk.cpik.route; import com.alk.cpik.*; public class RouteMgr {public static VehicleRoutingProfile profile=new VehicleRoutingProfile(); public static StopList stops=new StopList(); public static boolean ready=true; public static boolean selectionWorks=true; public static java.util.List<VehicleRoutingProfile> profiles=new java.util.ArrayList<>(); public static java.util.List<VehicleRoutingProfile> getVehicleRoutingProfiles(){return profiles;} public static VehicleRoutingProfile getVehicleRoutingProfile(String name){for(VehicleRoutingProfile p:profiles)if(p.name.equals(name))return p;return null;} public static void setActiveVehicleRoutingProfile(VehicleRoutingProfile p){if(selectionWorks)profile=p;} public static VehicleRoutingProfile getActiveVehicleRoutingProfile(){return profile;} public static boolean hasDestination(){return !stops.isEmpty();} public static boolean isCopilotReadyToAddStops(){return ready;} public static StopList getStopList(){return stops;} public static void addStops(RouteEnums.AddStopPurpose p,StopList s,RouteEnums.RoutePreviewMode m){if(m!=RouteEnums.RoutePreviewMode.NO_PREVIEW)throw new AssertionError("must start without preview");stops=s;}}',
 'com/semitrax/nativebridge/HandoffTest.java':`package com.semitrax.nativebridge;
import com.alk.cpik.*; import com.alk.cpik.route.*;
public class HandoffTest {
 static void check(boolean x){if(!x)throw new AssertionError();}
 static void denied(Throwing r)throws Exception{try{r.run();throw new AssertionError("unsafe acceptance");}catch(IllegalStateException expected){}}
 interface Throwing {void run() throws Exception;}
 public static void main(String[] args)throws Exception{
  CoPilotTripHandoff h=new CoPilotTripHandoff();
  RouteMgr.profile.type=RouteEnums.VehicleType.CAR;denied(()->h.review());
  RouteMgr.profile.type=RouteEnums.VehicleType.TRUCK_HEAVY_DUTY;h.review();String ticket=h.ticket();
  RouteMgr.ready=false;denied(()->h.validate(ticket));RouteMgr.ready=true;
  double[][] points={{40,-120},{41,-120}};String[] names={"origin","destination"};
  StopBuilder.restricted=true;denied(()->h.geocode(ticket,points,names));StopBuilder.restricted=false;
  StopList stops=h.geocode(ticket,points,names);h.submit(ticket,stops);check(!h.confirmed());
  StopList unrelated=new StopList();unrelated.add(new Stop("unrelated"));RouteListener.current.onStopsAdded(unrelated);check(h.pendingStops());
  RouteListener.current.onStopsAdded(stops);check(!h.pendingStops());check(!h.confirmed());
  RouteListener.current.onCompleteRouteCalculation();check(!h.confirmed());
  RouteListener.current.onStartRouteCalculation();RouteListener.current.onCompleteRouteCalculation();check(h.confirmed());
  RouteListener.current.onFailedRouteCalculation(1,stops.get(1));check(h.failed());check(!h.confirmed());
  RouteMgr.stops=new StopList();h.stopped();check(h.canReturnToPlanner());check(!h.confirmed());
  h.review();String cancelled=h.ticket();h.invalidateReview();denied(()->h.validate(cancelled));
  h.close();check(RouteListener.current==null);System.out.println("PASS: handoff safety, callbacks, correlation, failure and cancellation");
 }
}`,
};
files['com/semitrax/nativebridge/CoPilotMapDownload.java']=fs.readFileSync(path.join(root,'android/app/src/main/java/com/semitrax/nativebridge/CoPilotMapDownload.java'),'utf8');
files['com/semitrax/nativebridge/MapDownloadTest.java']=`package com.semitrax.nativebridge;
public class MapDownloadTest {
 static int downloads, resumes;
 static String call(String result, String resumed) {
  return CoPilotMapDownload.request(()->{downloads++;return result;},()->{resumes++;return resumed;},"FAILURE_PAUSED");
 }
 static void check(boolean value){if(!value)throw new AssertionError();}
 public static void main(String[] args) {
  check("SUCCESS".equals(call("FAILURE_PAUSED","SUCCESS"))); check(downloads==1 && resumes==1);
  check("FAILURE_PAUSED".equals(call("FAILURE_PAUSED","FAILURE_PAUSED"))); check(resumes==2);
  check("FAILURE_INSUFFICIENT_DISK_SPACE".equals(call("FAILURE_PAUSED","FAILURE_INSUFFICIENT_DISK_SPACE"))); check(resumes==3);
  for(String status:new String[]{"SUCCESS","FAILURE_DOWNLOADING","FAILURE_DOWNLOADED","FAILURE_INSTALLED","FAILURE_MANAGER_BUSY","FAILURE_UNLICENSED","FAILURE_INSUFFICIENT_DISK_SPACE"}) check(status.equals(call(status,"SUCCESS")));
  check(resumes==3); check(downloads==10);
  System.out.println("PASS: paused map resumes once; active, installed, storage and license results preserved");
 }
}`;
files['com/alk/cpik/route/VehicleRoutingProfileSource.java']='package com.alk.cpik.route; public enum VehicleRoutingProfileSource {DEFAULT,MANUAL,FLEET_PORTAL,API}';
files['com/semitrax/nativebridge/CoPilotFleetProfiles.java']=fs.readFileSync(path.join(root,'android/app/src/main/java/com/semitrax/nativebridge/CoPilotFleetProfiles.java'),'utf8');
files['com/semitrax/nativebridge/FleetProfilesTest.java']=`package com.semitrax.nativebridge;
import com.alk.cpik.*; import com.alk.cpik.route.*;
public class FleetProfilesTest {
 static void check(boolean x){if(!x)throw new AssertionError();}
 interface Action {void run()throws Exception;}
 static void denied(Action a)throws Exception{try{a.run();throw new AssertionError("unsafe selection");}catch(IllegalStateException expected){}}
 public static void main(String[] args)throws Exception{
  CoPilotFleetProfiles f=new CoPilotFleetProfiles();
  VehicleRoutingProfile fleet=new VehicleRoutingProfile();fleet.name="assigned";
  RouteMgr.profiles.add(fleet);
  for(VehicleRoutingProfileSource source:new VehicleRoutingProfileSource[]{VehicleRoutingProfileSource.DEFAULT,VehicleRoutingProfileSource.MANUAL,VehicleRoutingProfileSource.API}){VehicleRoutingProfile p=new VehicleRoutingProfile();p.source=source;RouteMgr.profiles.add(p);}
  VehicleRoutingProfile car=new VehicleRoutingProfile();car.type=RouteEnums.VehicleType.CAR;RouteMgr.profiles.add(car);
  check(f.read().size()==1);
  String ticket=f.read().get(0).ticket;fleet.restriction=2;denied(()->f.select(ticket));
  String next=f.read().get(0).ticket;check(f.select(next)==fleet);check(RouteMgr.profile==fleet);denied(()->f.select(next));
  String stale=f.read().get(0).ticket;f.read();denied(()->f.select(stale));
  String trip=f.read().get(0).ticket;RouteMgr.stops.add(new Stop("trip"));denied(()->f.select(trip));RouteMgr.stops.clear();
  String changed=f.read().get(0).ticket;fleet.source=VehicleRoutingProfileSource.MANUAL;denied(()->f.select(changed));fleet.source=VehicleRoutingProfileSource.FLEET_PORTAL;
  String mismatch=f.read().get(0).ticket;RouteMgr.profile=car;RouteMgr.selectionWorks=false;denied(()->f.select(mismatch));
  System.out.println("PASS: fleet origin, native profile preservation, changed/stale tickets, trip guard and selection readback");
 }
}`;
files['com/alk/cpik/DistanceUnit.java']='package com.alk.cpik; public class DistanceUnit {public int n; public DistanceUnit(int v){n=v;} public int getInches(){return n;}}';
files['com/alk/cpik/WeightUnit.java']='package com.alk.cpik; public class WeightUnit {public int n; public WeightUnit(int v){n=v;} public int getPounds(){return n;}}';
files['com/alk/cpik/route/VehicleDimensions.java']='package com.alk.cpik.route; import com.alk.cpik.*; public class VehicleDimensions {public DistanceUnit height=new DistanceUnit(162),width=new DistanceUnit(102),length=new DistanceUnit(636); public WeightUnit weight=new WeightUnit(80000),axle=new WeightUnit(34000); public DistanceUnit getHeight(){return height;} public DistanceUnit getWidth(){return width;} public DistanceUnit getLength(){return length;} public WeightUnit getTotalWeight(){return weight;} public WeightUnit getWeightPerAxle(){return axle;} public String toString(){return height.n+":"+width.n+":"+length.n+":"+weight.n+":"+axle.n;}}';
files['com/alk/cpik/route/RouteEnums.java']=files['com/alk/cpik/route/RouteEnums.java'].replace('public enum VehicleType', 'public enum RoutingType {QUICKEST,SHORTEST} public enum HazmatType {NONE,FLAMMABLE} public enum TollRoads {ALWAYS_AVOID,NO_RESTRICTION} public enum VehicleType');
files['com/alk/cpik/route/VehicleRoutingProfile.java']=files['com/alk/cpik/route/VehicleRoutingProfile.java'].replace('public int restriction=1;', 'public int restriction=1; public VehicleDimensions dims=new VehicleDimensions(); public RouteEnums.RoutingType routing=RouteEnums.RoutingType.QUICKEST; public RouteEnums.HazmatType hazmat=RouteEnums.HazmatType.NONE; public RouteEnums.TollRoads toll=RouteEnums.TollRoads.NO_RESTRICTION; public VehicleDimensions getVehicleDimensions(){return dims;} public RouteEnums.RoutingType getRoutingType(){return routing;} public RouteEnums.HazmatType getHazmatType(){return hazmat;} public RouteEnums.TollRoads getTollRoadUsage(){return toll;}').replace('name+type+source+restriction','name+type+source+restriction+dims.toString()+routing+hazmat+toll');
files['com/semitrax/nativebridge/CoPilotStandardTruck.java']=fs.readFileSync(path.join(root,'android/app/src/main/java/com/semitrax/nativebridge/CoPilotStandardTruck.java'),'utf8');
files['com/semitrax/nativebridge/StandardTruckTest.java']=`package com.semitrax.nativebridge;
import com.alk.cpik.*; import com.alk.cpik.route.*;
public class StandardTruckTest {
 interface Action {void run();}
 static void denied(Action a){try{a.run();throw new AssertionError("unverified truck accepted");}catch(IllegalStateException expected){}}
 static void verify(CoPilotStandardTruck v){v.verify(162,102,636,80000,34000,1,5,false);}
 public static void main(String[] args){
  CoPilotStandardTruck v=new CoPilotStandardTruck();
  denied(()->v.requireAccepted());verify(v);denied(()->v.requireAccepted());v.accept();v.requireAccepted();
  RouteMgr.profile.dims.height.n=161;denied(()->v.requireAccepted());denied(()->verify(v));RouteMgr.profile.dims.height.n=162;
  verify(v);v.accept();RouteMgr.profile.restriction++;denied(()->v.requireAccepted());
  verify(v);v.accept();verify(v);denied(()->v.requireAccepted());
  v.accept();v.clear();denied(()->v.requireAccepted());
  RouteMgr.profile.source=VehicleRoutingProfileSource.MANUAL;denied(()->verify(v));RouteMgr.profile.source=VehicleRoutingProfileSource.FLEET_PORTAL;
  RouteMgr.profile.hazmat=RouteEnums.HazmatType.FLAMMABLE;denied(()->verify(v));RouteMgr.profile.hazmat=RouteEnums.HazmatType.NONE;
  RouteMgr.profile.routing=RouteEnums.RoutingType.SHORTEST;denied(()->verify(v));RouteMgr.profile.routing=RouteEnums.RoutingType.QUICKEST;
  RouteMgr.profile.toll=RouteEnums.TollRoads.ALWAYS_AVOID;denied(()->verify(v));v.verify(162,102,636,80000,34000,1,5,true);v.accept();v.requireAccepted();
  denied(()->v.verify(162,102,636,80000,34000,2,5,true));
  denied(()->v.verify(162,102,882,80000,34000,1,5,true));
  denied(()->v.verify(163,102,636,80000,34000,1,5,true));
  denied(()->v.verify(162,102,636,80001,34000,1,5,true));
  denied(()->v.verify(162,102,636,80000,34001,1,5,true));
  denied(()->v.verify(162,102,636,80000,34000,1,6,true));
  denied(()->v.requireAccepted());
  System.out.println("PASS: standard truck scope, native readback, preferences, explicit consent and profile changes");
 }
}`;
try{
 const host=fs.readFileSync(path.join(root,'android/app/src/main/java/com/semitrax/nativebridge/CoPilotHostModule.java'),'utf8');
 const provisioning=host.slice(host.indexOf('  private WritableMap publicConfiguration()'),host.indexOf('  @ReactMethod public void configureDevice('));
 if(!provisioning.includes('return result;'))throw new Error('Provisioning method was not found');
 files['com/semitrax/nativebridge/ProvisioningTest.java']=`package com.semitrax.nativebridge;
public class ProvisioningTest {
 boolean started; int inventoryReads;
 static final String STORE="test-reference";
 static class WritableMap extends java.util.HashMap<String,Object> {
  void putString(String k,String v){put(k,v);} void putInt(String k,int v){put(k,v);}
  void putMap(String k,WritableMap v){put(k,v);}
 }
 static class Arguments {static WritableMap createMap(){return new WritableMap();}}
 static class Configuration {String getString(String k){return "TEST_REGION";}}
 Configuration configuration=new Configuration();
 static class MapInfo {int getYear(){return 2026;} int getQuarter(){return 1;} String getVersion(){return "installed";}}
 MapInfo selectedInstalled(){inventoryReads++;return new MapInfo();}
 static class CopilotMgr {
  static Version getVersionInfo(){throw new IllegalStateException("Engine not started");}
 }
 static class Version {String getAppVersion(){return "UNAVAILABLE";}}
 ${provisioning}
 static void check(boolean ok){if(!ok)throw new AssertionError("Provisioning must not depend on runtime SDK availability");}
 public static void main(String[] args)throws Exception {
  ProvisioningTest h=new ProvisioningTest();
  WritableMap before=h.publicConfiguration();
  check("11.3.0.2016".equals(before.get("sdkVersion")));
  check(h.inventoryReads==0);
  check("NOT_INSTALLED".equals(((WritableMap)before.get("mapVersion")).get("version")));
  h.started=true; WritableMap after=h.publicConfiguration();
  check("11.3.0.2016".equals(after.get("sdkVersion")));
  check(h.inventoryReads==1);
  check("installed".equals(((WritableMap)after.get("mapVersion")).get("version")));
  System.out.println("PASS: cold provisioning before SDK startup and installed-map readback after startup");
 }
}`;
 files['com/semitrax/nativebridge/CoPilotTripHandoff.java']=fs.readFileSync(path.join(root,'android/app/src/main/java/com/semitrax/nativebridge/CoPilotTripHandoff.java'),'utf8');
 for(const [name,body] of Object.entries(files)){const dest=path.join(dir,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,body);}
 const compile=spawnSync('java',['-m','jdk.compiler/com.sun.tools.javac.Main','-d',dir,...Object.keys(files).map(f=>path.join(dir,f))],{stdio:'inherit'});
 if(compile.status!==0)process.exitCode=1;
 else{for(const name of ['HandoffTest','ProvisioningTest','FleetProfilesTest','StandardTruckTest','MapDownloadTest']){const run=spawnSync('java',['-cp',dir,'com.semitrax.nativebridge.'+name],{stdio:'inherit'});if(run.status!==0)process.exitCode=1;}}
}finally{fs.rmSync(dir,{recursive:true,force:true});}
