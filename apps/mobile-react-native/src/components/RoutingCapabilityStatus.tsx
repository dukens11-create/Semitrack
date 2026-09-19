import React,{useEffect,useState} from 'react';
import {StyleSheet,Text} from 'react-native';
import type {ApiClient} from '../services/api/ApiClient';
import {capabilitiesSchema,planningStatus,type Capabilities} from '../features/routing/capabilities';
export function RoutingCapabilityStatus({api,verified,phase,errorCode,color}:{api:ApiClient;verified:boolean;phase:string;errorCode?:string;color:string}) {
 const [capabilities,setCapabilities]=useState<Capabilities>();
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{const controller=new AbortController();let live=true;setCapabilities(undefined);
  void Promise.resolve().then(()=>api.request('GET','/capabilities',undefined,controller.signal)).then(value=>{const parsed=capabilitiesSchema.safeParse(value);if(live){setNow(Date.now());setCapabilities(parsed.success?parsed.data:undefined);}}).catch(()=>{if(live)setCapabilities(undefined);});
  return()=>{live=false;controller.abort();};
 },[api,phase]);
 useEffect(()=>{const expiry=Date.parse(capabilities?.truckRouting.validUntil??'');if(!Number.isFinite(expiry)||expiry<=Date.now())return;
  const timer=setTimeout(()=>setNow(Date.now()),Math.min(expiry-Date.now()+1,300001));return()=>clearTimeout(timer);
 },[capabilities]);
 return <Text accessibilityLiveRegion="polite" style={[styles.status,{color}]}>{planningStatus({verified,phase,errorCode,capabilities,now})}</Text>;
}
const styles=StyleSheet.create({status:{fontSize:12}});
