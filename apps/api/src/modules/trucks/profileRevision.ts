import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Prisma, PrismaClient, Truck } from '@prisma/client';
import { truckSchema, truckUpdateSchema } from './truck.schemas.js';
import { deny } from '../admin/operationalPolicy.js';
export function isVerifiedTruck(truck: Pick<Truck,'revision'|'verifiedRevision'|'verificationState'|'verifiedByUserId'|'userId'>){return truck.revision>0&&truck.verificationState==='VERIFIED'&&truck.verifiedRevision===truck.revision&&truck.verifiedByUserId===truck.userId;}
export function publicTruck(truck:Truck){return {...truck,verificationState:isVerifiedTruck(truck)?'VERIFIED':truck.verificationState==='ADMIN_UPDATED'?'ADMIN_UPDATED':'DRIVER_VERIFICATION_REQUIRED'};}
export async function auditTruck(tx:Prisma.TransactionClient,actorUserId:string,action:string,truck:Truck,before:Truck|null,reason?:string,operation?:{id:string;hash:string}){
 await tx.adminAuditLog.create({data:{...(operation?{id:operation.id}:{}),actorUserId,action,targetType:'TRUCK',targetId:truck.id,metadataJson:{...(operation?{createRequestHash:operation.hash}:{}),ownerUserId:truck.userId,reason:reason??null,before:before?JSON.parse(JSON.stringify(before)):null,after:JSON.parse(JSON.stringify(truck))}}});
}
export async function saveTruck(db:PrismaClient,userId:string,actorUserId:string,input:unknown,id?:string,expectedRevision?:number,reason?:string){
 // Retry only transaction conflicts; a replay is resolved through the durable audit key.
 for(let attempt=0;;attempt++){
  try{return await db.$transaction(tx=>saveTruckInTransaction(tx,userId,actorUserId,input,id,expectedRevision,reason),{isolationLevel:'Serializable'});}
  catch(error){if(id || !createOperation(input) || attempt>=2 || !['P2002','P2034'].includes((error as {code?:string}).code??''))throw error;}
 }
}
function createOperation(input:unknown){return z.object({createOperationId:z.string().uuid().optional()}).parse(input).createOperationId;}
export async function saveTruckInTransaction(tx:Prisma.TransactionClient,userId:string,actorUserId:string,input:unknown,id?:string,expectedRevision?:number,reason?:string){
  const key=!id?createOperation(input):undefined;
  const operation=key?{id:'truck-create:'+createHash('sha256').update(JSON.stringify([userId,key])).digest('hex'),hash:createHash('sha256').update(JSON.stringify(truckSchema.parse(input))).digest('hex')}:undefined;
  if(operation){
   const prior=await tx.adminAuditLog.findUnique({where:{id:operation.id}});
   if(prior){
    const meta=prior.metadataJson as {ownerUserId?:string;createRequestHash?:string;after?:Truck}|null;
    if(prior.actorUserId!==actorUserId || prior.action!=='TRUCK_CREATED' || prior.targetType!=='TRUCK' || meta?.ownerUserId!==userId || meta.createRequestHash!==operation.hash)deny('TRUCK_CREATE_OPERATION_CONFLICT',409);
    const original=meta!.after!;
    if(!original || original.userId!==userId || original.id!==prior.targetId)deny('TRUCK_CREATE_OPERATION_CONFLICT',409);
    // Do not resurrect a deleted result or overwrite a subsequently edited revision.
    if(!await tx.truck.findFirst({where:{id:original.id,userId}}))deny('TRUCK_CREATE_RESULT_REMOVED',409);
    return publicTruck({...original,createdAt:new Date(original.createdAt),updatedAt:new Date(original.updatedAt),verifiedAt:original.verifiedAt?new Date(original.verifiedAt):null});
   }
  }
  const before=id?await tx.truck.findFirst({where:{id,userId}}):null;
  if(id&&!before)deny('TRUCK_NOT_FOUND',404);
  if(before&&expectedRevision!==before.revision)deny('TRUCK_PROFILE_CHANGED',409);
  const fields=before?truckUpdateSchema.parse(input):truckSchema.parse(input);
  truckSchema.parse({...before,...fields});
  const data={...fields,isDefault:false,verifiedRevision:null,verifiedAt:null,verifiedByUserId:null,verificationState:actorUserId===userId?'DRIVER_VERIFICATION_REQUIRED' as const:'ADMIN_UPDATED' as const};
  const truck=before?await tx.truck.update({where:{id:before.id},data:{...data,revision:{increment:1}}}):await tx.truck.create({data:{...truckSchema.parse(input),...data,userId}});
  await auditTruck(tx,actorUserId,before?'TRUCK_UPDATED':'TRUCK_CREATED',truck,before,reason,operation);return publicTruck(truck);
}
export async function verifyTruck(db:PrismaClient,userId:string,id:string,expectedRevision:number){
 return db.$transaction(async tx=>{
  const before=await tx.truck.findFirst({where:{id,userId}});if(!before)deny('TRUCK_NOT_FOUND',404);
  if(before.revision!==expectedRevision)deny('TRUCK_PROFILE_CHANGED',409);
  truckSchema.parse(before);
  await tx.truck.updateMany({where:{userId,id:{not:id},isDefault:true},data:{isDefault:false}});
  const truck=await tx.truck.update({where:{id},data:{isDefault:true,verifiedRevision:before.revision,verifiedAt:new Date(),verifiedByUserId:userId,verificationState:'VERIFIED'}});
  await auditTruck(tx,userId,'TRUCK_DRIVER_VERIFIED',truck,before);return publicTruck(truck);
 },{isolationLevel:'Serializable'});
}
