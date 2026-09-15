import type { Prisma, PrismaClient, Truck } from '@prisma/client';
import { truckSchema, truckUpdateSchema } from './truck.schemas.js';
import { deny } from '../admin/operationalPolicy.js';
export function isVerifiedTruck(truck: Pick<Truck,'revision'|'verifiedRevision'|'verificationState'|'verifiedByUserId'|'userId'>){return truck.revision>0&&truck.verificationState==='VERIFIED'&&truck.verifiedRevision===truck.revision&&truck.verifiedByUserId===truck.userId;}
export function publicTruck(truck:Truck){return {...truck,verificationState:isVerifiedTruck(truck)?'VERIFIED':truck.verificationState==='ADMIN_UPDATED'?'ADMIN_UPDATED':'DRIVER_VERIFICATION_REQUIRED'};}
export async function auditTruck(tx:Prisma.TransactionClient,actorUserId:string,action:string,truck:Truck,before:Truck|null,reason?:string){
 await tx.adminAuditLog.create({data:{actorUserId,action,targetType:'TRUCK',targetId:truck.id,metadataJson:{ownerUserId:truck.userId,reason:reason??null,before:before?JSON.parse(JSON.stringify(before)):null,after:JSON.parse(JSON.stringify(truck))}}});
}
export async function saveTruck(db:PrismaClient,userId:string,actorUserId:string,input:unknown,id?:string,expectedRevision?:number,reason?:string){
 return db.$transaction(tx=>saveTruckInTransaction(tx,userId,actorUserId,input,id,expectedRevision,reason),{isolationLevel:'Serializable'});
}
export async function saveTruckInTransaction(tx:Prisma.TransactionClient,userId:string,actorUserId:string,input:unknown,id?:string,expectedRevision?:number,reason?:string){
  const before=id?await tx.truck.findFirst({where:{id,userId}}):null;
  if(id&&!before)deny('TRUCK_NOT_FOUND',404);
  if(before&&expectedRevision!==before.revision)deny('TRUCK_PROFILE_CHANGED',409);
  const fields=before?truckUpdateSchema.parse(input):truckSchema.parse(input);
  truckSchema.parse({...before,...fields});
  const data={...fields,isDefault:false,verifiedRevision:null,verifiedAt:null,verifiedByUserId:null,verificationState:actorUserId===userId?'DRIVER_VERIFICATION_REQUIRED' as const:'ADMIN_UPDATED' as const};
  const truck=before?await tx.truck.update({where:{id:before.id},data:{...data,revision:{increment:1}}}):await tx.truck.create({data:{...truckSchema.parse(input),...data,userId}});
  await auditTruck(tx,actorUserId,before?'TRUCK_UPDATED':'TRUCK_CREATED',truck,before,reason);return publicTruck(truck);
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
