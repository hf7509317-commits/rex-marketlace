import {describe,it,expect,afterAll} from 'vitest';import {randomUUID} from 'node:crypto';
import {db} from '../src/db.js';import {savePlan,savePromo,sendNotification} from '../src/admin.js';
if(!process.env.DATABASE_URL?.includes('/rexmarket_test?'))throw new Error('Gunakan rexmarket_test saja');
const users:string[]=[];const plans:string[]=[];const promos:string[]=[];
async function user(role:'CUSTOMER'|'ADMIN'|'SUPER_ADMIN'){
 const u=await db.user.create({data:{email:`${randomUUID()}@admin-test.example`,passwordHash:'not-a-login-hash',role}});users.push(u.id);return u;
}
describe('Audited shared admin services',()=>{
 it('admin cannot create a reseller plan',async()=>{const admin=await user('ADMIN');await expect(savePlan(admin.id,{name:randomUUID(),price:50000,durationDays:30,productLimit:10,platformFeeBps:1000,active:true})).rejects.toThrow('Tidak berwenang');});
 it('plan creation and update have audit records',async()=>{
  const root=await user('SUPER_ADMIN');const input={name:randomUUID(),price:50000,durationDays:30,productLimit:10,platformFeeBps:1000,active:true};
  const p=await savePlan(root.id,input);plans.push(p.id);await savePlan(root.id,{...input,price:70000},p.id);
  const audit=await db.auditLog.findMany({where:{actorId:root.id,resourceId:p.id}});expect(audit).toHaveLength(2);expect(audit.map(r=>r.action)).toContain('PLAN_UPDATED');
 });
 it('disabled super admin cannot modify plans',async()=>{const root=await user('SUPER_ADMIN');await db.user.update({where:{id:root.id},data:{active:false}});await expect(savePlan(root.id,{name:randomUUID(),price:50000,durationDays:null,productLimit:10,platformFeeBps:0,active:true})).rejects.toThrow('Tidak berwenang');});
 it('expired active promo is rejected before any write',async()=>{const root=await user('SUPER_ADMIN');const code=`T${randomUUID().replace(/-/g,'').slice(0,20).toUpperCase()}`;await expect(savePromo(root.id,{code,percent:10,expiresAt:'2000-01-01T00:00:00Z',active:true})).rejects.toThrow('kedaluwarsa');expect(await db.promo.findUnique({where:{code}})).toBeNull();});
 it('notification contents are not copied into audit',async()=>{const admin=await user('ADMIN');const customer=await user('CUSTOMER');const n=await sendNotification(admin.id,{userId:customer.id,message:'Private message'});const audit=await db.auditLog.findFirstOrThrow({where:{resourceId:n.id}});expect(JSON.stringify(audit.details)).not.toContain('Private message');});
});
afterAll(async()=>{
 await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.notification.deleteMany({where:{userId:{in:users}}});await db.plan.deleteMany({where:{id:{in:plans}}});await db.promo.deleteMany({where:{code:{in:promos}}});await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();
});
