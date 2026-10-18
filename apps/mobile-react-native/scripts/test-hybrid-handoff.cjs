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
 'com/alk/cpik/route/RouteEnums.java':'package com.alk.cpik.route; public class RouteEnums {public enum VehicleType {TRUCK_HEAVY_DUTY,CAR} public enum AddStopPurpose {NEW_TRIP} public enum RoutePreviewMode {NO_PREVIEW}}',
 'com/alk/cpik/route/VehicleRoutingProfile.java':'package com.alk.cpik.route; public class VehicleRoutingProfile {public RouteEnums.VehicleType type=RouteEnums.VehicleType.TRUCK_HEAVY_DUTY; public String name="truck"; public String getName(){return name;} public RouteEnums.VehicleType getVehicleType(){return type;} public boolean equals_RoutingFieldsOnly(VehicleRoutingProfile p){return name.equals(p.name)&&type==p.type;}}',
 'com/alk/cpik/route/RouteListener.java':'package com.alk.cpik.route; import com.alk.cpik.*; public class RouteListener {public static RouteListener current; public static void registerListener(RouteListener l){current=l;} public static void unregisterListener(RouteListener l){current=null;} public void onStopsAdded(StopList s){} public void onStopsDeleted(StopList s){} public void onStartRouteCalculation(){} public void onCompleteRouteCalculation(){} public void onFailedRouteCalculation(int l,Stop s){}}',
 'com/alk/cpik/route/RouteMgr.java':'package com.alk.cpik.route; import com.alk.cpik.*; public class RouteMgr {public static VehicleRoutingProfile profile=new VehicleRoutingProfile(); public static StopList stops=new StopList(); public static boolean ready=true; public static VehicleRoutingProfile getActiveVehicleRoutingProfile(){return profile;} public static boolean hasDestination(){return !stops.isEmpty();} public static boolean isCopilotReadyToAddStops(){return ready;} public static StopList getStopList(){return stops;} public static void addStops(RouteEnums.AddStopPurpose p,StopList s,RouteEnums.RoutePreviewMode m){stops=s;}}',
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
try{
 files['com/semitrax/nativebridge/CoPilotTripHandoff.java']=fs.readFileSync(path.join(root,'android/app/src/main/java/com/semitrax/nativebridge/CoPilotTripHandoff.java'),'utf8');
 for(const [name,body] of Object.entries(files)){const dest=path.join(dir,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,body);}
 const compile=spawnSync('java',['-m','jdk.compiler/com.sun.tools.javac.Main','-d',dir,...Object.keys(files).map(f=>path.join(dir,f))],{stdio:'inherit'});
 if(compile.status!==0)process.exitCode=1;
 else{const run=spawnSync('java',['-cp',dir,'com.semitrax.nativebridge.HandoffTest'],{stdio:'inherit'});if(run.status!==0)process.exitCode=1;}
}finally{fs.rmSync(dir,{recursive:true,force:true});}
