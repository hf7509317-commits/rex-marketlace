import {z} from 'zod';
import {atomic,DomainError} from './db.js';
import {requireAdmin,planInput,productInput,subscription} from './services.js';
export async function savePlan(actorId:string,raw:unknown,id?:string){
 const data=planInput.parse(raw);
 return atomic(async tx=>{
  await requireAdmin(actorId,true,tx);
  const before=id?await tx.plan.findUnique({where:{id}}):null;
  if(id&&!before)throw new DomainError(404,'Paket tidak ditemukan');
  const result=id?await tx.plan.update({where:{id},data}):await tx.plan.create({data});
  await tx.auditLog.create({data:{actorId,action:id?'PLAN_UPDATED':'PLAN_CREATED',resourceId:result.id,details:{before:before?{name:before.name,price:before.price,durationDays:before.durationDays,productLimit:before.productLimit,platformFeeBps:before.platformFeeBps,active:before.active}:null,after:data}}});
  return result;
 });
}
export async function savePromo(actorId:string,raw:unknown){
 const data=z.object({code:z.string().regex(/^[A-Z0-9_-]{2,40}$/),percent:z.number().int().min(1).max(90),expiresAt:z.coerce.date(),active:z.boolean()}).strict().parse(raw);
 if(data.active&&data.expiresAt<=new Date())throw new DomainError(400,'Promo aktif memerlukan tanggal kedaluwarsa mendatang');
 return atomic(async tx=>{
  await requireAdmin(actorId,true,tx);
  const before=await tx.promo.findUnique({where:{code:data.code}});
  const result=await tx.promo.upsert({where:{code:data.code},create:data,update:data});
  await tx.auditLog.create({data:{actorId,action:'PROMO_UPDATED',resourceId:data.code,details:{before:before?{percent:before.percent,expiresAt:before.expiresAt.toISOString(),active:before.active}:null,after:{...data,expiresAt:data.expiresAt.toISOString()}}}});return result;
 });
}
export async function sendNotification(actorId:string,raw:unknown){
 const data=z.object({userId:z.string().cuid(),message:z.string().trim().min(1).max(2000)}).strict().parse(raw);
 return atomic(async tx=>{
  await requireAdmin(actorId,false,tx);
  if(!await tx.user.findUnique({where:{id:data.userId}}))throw new DomainError(404,'User tidak ditemukan');
  const result=await tx.notification.create({data});
  // Content is excluded from audit to avoid duplicating sensitive messages.
  await tx.auditLog.create({data:{actorId,action:'NOTIFICATION_CREATED',resourceId:result.id,details:{userId:data.userId}}});return result;
 });
}
export async function editProduct(actorId:string,id:string,raw:unknown){
 const data=productInput.parse(raw);
 return atomic(async tx=>{
  const user=await tx.user.findUnique({where:{id:actorId}});
  if(!user?.active||!['RESELLER','ADMIN','SUPER_ADMIN'].includes(user.role))throw new DomainError(403,'Perlu akun reseller aktif');
  if(user.role==='RESELLER'&&!await subscription(actorId,tx))throw new DomainError(403,'Paket tidak aktif');
  const before=await tx.product.findFirst({where:{id,sellerId:actorId}});if(!before)throw new DomainError(404,'Produk tidak ditemukan');
  const result=await tx.product.update({where:{id},data:{...data,approved:false}});
  await tx.auditLog.create({data:{actorId,action:'PRODUCT_UPDATED',resourceId:id,details:{before:{title:before.title,price:before.price,approved:before.approved},after:{title:data.title,price:data.price,approved:false}}}});return result;
 });
}
export async function reviewProduct(actorId:string,id:string,raw:unknown){
 const data=z.object({approved:z.boolean(),active:z.boolean()}).strict().parse(raw);
 return atomic(async tx=>{
  await requireAdmin(actorId,false,tx);
  const before=await tx.product.findUnique({where:{id}});if(!before)throw new DomainError(404,'Produk tidak ditemukan');
  const result=await tx.product.update({where:{id},data});
  await tx.auditLog.create({data:{actorId,action:'PRODUCT_REVIEWED',resourceId:id,details:{before:{approved:before.approved,active:before.active},after:data}}});return result;
 });
}
