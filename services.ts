import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Role, Prisma } from '@prisma/client';
import { z } from 'zod';
import { db, atomic, DomainError } from './db.js';
import { env } from './config.js';
export const productInput = z.object({ title:z.string().trim().min(2).max(150), description:z.string().max(5000), category:z.string().min(1).max(80), price:z.number().int().min(1).max(100000000) }).strict();
export const planInput = z.object({ name:z.string().min(2).max(80), price:z.number().int().min(1).max(100000000), durationDays:z.number().int().min(1).max(36500).nullable(), productLimit:z.number().int().min(1).max(100000), platformFeeBps:z.number().int().min(0).max(10000), active:z.boolean() }).strict();
export async function requireAdmin(actorId: string, superOnly = false, tx: Prisma.TransactionClient = db) {
  const u = await tx.user.findUnique({ where: {id:actorId} });
  if (!u?.active || (superOnly ? u.role !== 'SUPER_ADMIN' : !['ADMIN','SUPER_ADMIN'].includes(u.role))) throw new DomainError(403,'Tidak berwenang'); return u;
}
export async function subscription(userId: string, tx: Prisma.TransactionClient = db) {
  return tx.subscription.findFirst({ where: { userId, revoked:false, OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}] }, orderBy:{startsAt:'desc'} });
}
export function encrypt(value: string) {
  const iv=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',Buffer.from(env.DELIVERY_ENCRYPTION_KEY,'hex'),iv);
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return [iv.toString('hex'),cipher.getAuthTag().toString('hex'),encrypted.toString('hex')].join('.');
}
export function decrypt(value: string) {
  const [iv,tag,data]=value.split('.'); const cipher=createDecipheriv('aes-256-gcm',Buffer.from(env.DELIVERY_ENCRYPTION_KEY,'hex'),Buffer.from(iv,'hex'));
  cipher.setAuthTag(Buffer.from(tag,'hex')); return Buffer.concat([cipher.update(Buffer.from(data,'hex')),cipher.final()]).toString('utf8');
}
export async function createProduct(userId: string, raw: unknown) {
  const data=productInput.parse(raw);
  return atomic(async tx => {
    const user=await tx.user.findUnique({where:{id:userId}});
    if (!user?.active || !['RESELLER','ADMIN','SUPER_ADMIN'].includes(user.role)) throw new DomainError(403,'Perlu akun reseller');
    const sub=await subscription(userId,tx);
    if (user.role === 'RESELLER') {
      if (!sub) throw new DomainError(403,'Paket tidak aktif');
      if (await tx.product.count({where:{sellerId:userId,active:true}}) >= sub.productLimit) throw new DomainError(409,'Batas produk paket tercapai');
    }
    const product = await tx.product.create({data:{...data,sellerId:userId,platformFeeBps:sub?.platformFeeBps ?? 0}});
    await tx.auditLog.create({data:{actorId:userId,action:'PRODUCT_CREATED',resourceId:product.id,details:{title:data.title,price:data.price}}});
    return product;
  });
}
export async function addStock(userId: string, productId: string, values: string[]) {
  const units=z.array(z.string().min(1).max(10000)).min(1).max(100).parse(values);
  return atomic(async tx => {
    const p=await tx.product.findFirst({where:{id:productId,sellerId:userId}});
    if (!p) throw new DomainError(404,'Produk tidak ditemukan');
    const user=await tx.user.findUnique({where:{id:userId}});
    if (!user?.active || (user.role==='RESELLER' && !await subscription(userId,tx))) throw new DomainError(403,'Paket tidak aktif');
    await tx.digitalUnit.createMany({data:units.map(value=>({productId,ciphertext:encrypt(value)}))});
    const product = await tx.product.update({where:{id:productId},data:{stock:{increment:units.length}}});
    await tx.auditLog.create({data:{actorId:userId,action:'STOCK_ADDED',resourceId:productId,details:{quantity:units.length}}});
    return product;
  });
}
export async function submitProof(userId: string, orderId: string, mediaId: string) {
  return atomic(async tx => {
    const order=await tx.order.findFirst({where:{id:orderId,buyerId:userId}});
    const media=await tx.media.findFirst({where:{id:mediaId,ownerId:userId,public:false}});
    if (!order || !media) throw new DomainError(404,'Pesanan atau media tidak ditemukan');
    if (!['AWAITING_PAYMENT','REJECTED'].includes(order.status)) throw new DomainError(409,'Pesanan tidak menerima bukti baru');
    if (await tx.paymentProof.findFirst({where:{storageKey:media.key}})) throw new DomainError(409,'Bukti sudah digunakan');
    const prior=await tx.paymentProof.findFirst({where:{orderId},orderBy:{version:'desc'}});
    const proof=await tx.paymentProof.create({data:{orderId,storageKey:media.key,version:(prior?.version ?? 0)+1}});
    await tx.order.update({where:{id:orderId},data:{status:'PENDING_REVIEW'}});
    await tx.outbox.create({data:{key:`proof:${proof.id}`,topic:'payment.submitted',payload:{proofId:proof.id}}});
    await tx.auditLog.create({data:{actorId:userId,action:'PAYMENT_PROOF_SUBMITTED',resourceId:proof.id,details:{orderId,version:proof.version}}});
    return proof;
  });
}
export async function settings() {
  const rows=await db.setting.findMany(); return Object.fromEntries(rows.map(r=>[r.key,r.value]));
}
const settingValidators: Record<string,z.ZodTypeAny>={name:z.string().min(1).max(120),terms:z.string().max(30000),maintenance:z.boolean(),categories:z.array(z.string().min(1).max(80)).max(100),logo:z.string().cuid().nullable(),banner:z.string().cuid().nullable(),qris:z.string().cuid().nullable()};
export async function setSetting(actorId: string, key: string, raw: unknown) {
  await requireAdmin(actorId,true);
  if (!settingValidators[key]) throw new DomainError(400,'Setting tidak dikenal');
  const value=settingValidators[key].parse(raw);
  if (['logo','banner','qris'].includes(key) && value && !await db.media.findFirst({where:{id:value,public:true,mime:{startsWith:'image/'}}})) throw new DomainError(400,'Media publik tidak valid');
  const storedValue = value === null ? Prisma.JsonNull : value;
  return atomic(async tx=>{
    await requireAdmin(actorId,true,tx);
    const setting=await tx.setting.upsert({where:{key},create:{key,value:storedValue},update:{value:storedValue}});
    await tx.auditLog.create({data:{actorId,action:'SETTING_UPDATED',resourceId:key,details:{key}}}); return setting;
  });
}
export async function changeUser(actorId: string, userId: string, raw: unknown) {
  await requireAdmin(actorId,true);
  const input=z.object({role:z.nativeEnum(Role),active:z.boolean()}).strict().parse(raw);
  if(userId===actorId) throw new DomainError(409,'Tidak bisa mengubah akses sendiri');
  return atomic(async tx=>{
    await requireAdmin(actorId,true,tx);
    const target=await tx.user.findUnique({where:{id:userId}});
    if (!target) throw new DomainError(404,'User tidak ditemukan');
    if (target.role==='SUPER_ADMIN' && (input.role!=='SUPER_ADMIN'||!input.active) && await tx.user.count({where:{role:'SUPER_ADMIN',active:true}})<=1) throw new DomainError(409,'Super Admin terakhir harus tetap aktif');
    const user=await tx.user.update({where:{id:userId},data:input});
    await tx.session.deleteMany({where:{userId}});
    await tx.auditLog.create({data:{actorId,action:'USER_UPDATED',resourceId:userId,details:input}});
    return {id:user.id,email:user.email,role:user.role,active:user.active};
  });
}
export async function dashboard(userId: string) {
  const user=await db.user.findUniqueOrThrow({where:{id:userId}});
  if (['ADMIN','SUPER_ADMIN'].includes(user.role)) {
    const [users,orders,pendingPayments,pendingProducts,commission,logs]=await Promise.all([
      db.user.count(),db.order.aggregate({where:{status:'PAID'},_sum:{total:true},_count:true}),db.order.count({where:{status:'PENDING_REVIEW'}}),db.product.count({where:{approved:false,active:true}}),db.commission.aggregate({_sum:{platformFee:true,net:true}}),db.auditLog.findMany({take:20,orderBy:{createdAt:'desc'}})
    ]);return {users,orders,pendingPayments,pendingProducts,commission,logs};
  }
  const [ledger,sub,products]=await Promise.all([db.commission.aggregate({where:{sellerId:userId},_sum:{gross:true,platformFee:true,net:true},_count:true}),subscription(userId),db.product.count({where:{sellerId:userId,active:true}})]);
  return {ledger,subscription:sub,products};
}
