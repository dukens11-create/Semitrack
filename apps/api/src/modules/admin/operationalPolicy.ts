import type { Prisma, PrismaClient, StaffRole } from '@prisma/client';
export type OperationalPermission = 'drivers.read'|'drivers.manage'|'trucks.read'|'trucks.edit'|'equipment.read'|'equipment.manage'|'dispatch.read'|'dispatch.manage'|'support.read'|'support.manage'|'notifications.send'|'billing.read'|'roles.manage'|'audit.read';
const policy: Record<StaffRole, readonly OperationalPermission[]> = {
 SUPER_ADMIN:['drivers.read','drivers.manage','trucks.read','trucks.edit','equipment.read','equipment.manage','dispatch.read','dispatch.manage','support.read','support.manage','notifications.send','billing.read','roles.manage','audit.read'],
 OPERATIONS:['drivers.read','drivers.manage','trucks.read','trucks.edit','equipment.read','equipment.manage','dispatch.read','dispatch.manage','support.read','support.manage','notifications.send'],
 DISPATCH:['drivers.read','trucks.read','equipment.read','dispatch.read','dispatch.manage','notifications.send'],
 SAFETY:['drivers.read','trucks.read','trucks.edit','equipment.read','dispatch.read','audit.read'],
 SUPPORT:['drivers.read','support.read','support.manage','notifications.send'],
 BILLING:['drivers.read','billing.read'],
 READ_ONLY:['drivers.read','trucks.read','equipment.read','dispatch.read'],
};
export type OperationalActor = { userId:string; role:StaffRole; globalScope:boolean; fleetIds:string[] };
export function can(actor: OperationalActor, permission:OperationalPermission) { return policy[actor.role]?.includes(permission) === true; }
export function deny(code='FORBIDDEN', status=403):never { throw Object.assign(new Error('The requested operation is not authorized.'),{safeCode:code,safeStatus:status}); }
export async function operationalActor(db:Pick<PrismaClient,'staffAccess'>, user:{userId:string;role:string}):Promise<OperationalActor> {
 if(user.role==='ADMIN')return {userId:user.userId,role:'SUPER_ADMIN',globalScope:true,fleetIds:[]};
 const grant=await db.staffAccess.findUnique({where:{userId:user.userId},include:{fleets:{where:{fleet:{active:true}},select:{fleetId:true}}}});
 if(!grant)deny();
 return {userId:user.userId,role:grant.role,globalScope:grant.globalScope,fleetIds:grant.fleets.map(f=>f.fleetId)};
}
export function requirePermission(actor:OperationalActor,permission:OperationalPermission){if(!can(actor,permission))deny();}
export function operationalDriverScope(actor:OperationalActor):Prisma.UserWhereInput {
 return {role:'DRIVER',disabledAt:undefined,...(actor.globalScope?{}:{operationalMemberships:{some:{active:true,fleetId:{in:actor.fleetIds},fleet:{active:true}}}})};
}
export async function requireDriver(db:Pick<Prisma.TransactionClient,'user'>,actor:OperationalActor,userId:string){
 const user=await db.user.findFirst({where:{AND:[{id:userId},operationalDriverScope(actor)]},select:{id:true,staffAccess:{select:{id:true}}}});
 if(!user || user.staffAccess)deny('DRIVER_NOT_FOUND',404);return user;
}
export function fleetScope(actor:OperationalActor):Prisma.OperationalFleetWhereInput{return actor.globalScope?{}:{id:{in:actor.fleetIds}};}
