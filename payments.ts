import { z } from 'zod';
import { atomic, DomainError } from './db.js';
const planSnapshot=z.object({name:z.string(),durationDays:z.number().int().positive().nullable(),productLimit:z.number().int().positive(),platformFeeBps:z.number().int().min(0).max(10000)});
export async function reviewPayment(actorId:string,proofId:string,approve:boolean,reason?:string){
 if(!approve&&(!reason||reason.trim().length<3||reason.length>1000))throw new DomainError(400,'Alasan penolakan wajib 3–1000 karakter');
 return atomic(async tx=>{
  const actor=await tx.user.findUnique({where:{id:actorId}});
  if(!actor?.active||!['ADMIN','SUPER_ADMIN'].includes(actor.role))throw new DomainError(403,'Tidak berwenang');
  const proof=await tx.paymentProof.findUnique({where:{id:proofId},include:{order:{include:{items:true}}}});
  if(!proof)throw new DomainError(404,'Bukti tidak ditemukan');
  if(proof.status==='APPROVED'&&approve&&proof.order.status==='PAID')return {orderId:proof.orderId,status:'PAID',alreadyApplied:true};
  const latest=await tx.paymentProof.findFirst({where:{orderId:proof.orderId},orderBy:{version:'desc'}});
  if(latest?.id!==proof.id||proof.status!=='PENDING')throw new DomainError(409,'Bukti sudah diproses atau kedaluwarsa');
  const claimed=await tx.order.updateMany({where:{id:proof.orderId,status:'PENDING_REVIEW'},data:{status:approve?'PAID':'REJECTED',paidAt:approve?new Date():null}});
  if(claimed.count!==1)throw new DomainError(409,'Pesanan sudah diproses');
  if(approve&&proof.order.kind==='PLAN'){
   const buyer=await tx.user.findUniqueOrThrow({where:{id:proof.order.buyerId}});
   if(!buyer.active||!['CUSTOMER','RESELLER'].includes(buyer.role))throw new DomainError(409,'Akun pembeli tidak bisa diaktifkan sebagai reseller');
   const snap=planSnapshot.parse(proof.order.planSnapshot);if(!proof.order.planId)throw new DomainError(409,'Paket tidak valid');
   const prior=await tx.subscription.findFirst({where:{userId:buyer.id,revoked:false},orderBy:{startsAt:'desc'}});
   // Buying a new tier replaces its limits; remaining timed days carry forward.
   // A permanent subscription remains permanent on renewal.
   const permanent=snap.durationDays===null||!!prior&&prior.expiresAt===null;
   const base=Math.max(Date.now(),prior?.expiresAt?.getTime()??0);
   await tx.subscription.updateMany({where:{userId:buyer.id,revoked:false},data:{revoked:true}});
   await tx.subscription.create({data:{userId:buyer.id,planId:proof.order.planId,orderId:proof.orderId,productLimit:snap.productLimit,platformFeeBps:snap.platformFeeBps,expiresAt:permanent?null:new Date(base+snap.durationDays!*86400000)}});
   await tx.user.update({where:{id:buyer.id},data:{role:'RESELLER'}});
  }
  if(approve&&proof.order.kind==='PRODUCT'){
   for(const item of [...proof.order.items].sort((a,b)=>a.productId.localeCompare(b.productId))){
    const changed=await tx.product.updateMany({where:{id:item.productId,stock:{gte:item.quantity}},data:{stock:{decrement:item.quantity}}});
    if(changed.count!==1)throw new DomainError(409,'Stok tidak mencukupi; admin harus menindaklanjuti pembayaran');
    const units=await tx.digitalUnit.findMany({where:{productId:item.productId,consumed:false},orderBy:{id:'asc'},take:item.quantity});
    if(units.length!==item.quantity)throw new DomainError(409,'Stok digital tidak konsisten');
    const allocated=await tx.digitalUnit.updateMany({where:{id:{in:units.map(u=>u.id)},consumed:false},data:{consumed:true,deliveredOrderId:proof.orderId,deliveredBuyerId:proof.order.buyerId}});
    if(allocated.count!==item.quantity)throw new DomainError(409,'Stok digital sedang diproses');
    const gross=item.priceSnapshot*item.quantity;const platformFee=Math.floor(gross*item.platformFeeBpsSnapshot/10000);
    await tx.commission.create({data:{itemId:item.id,sellerId:item.sellerIdSnapshot,gross,platformFee,net:gross-platformFee}});
   }
  }
  await tx.paymentProof.update({where:{id:proof.id},data:{status:approve?'APPROVED':'REJECTED',reviewerId:actorId,reviewedAt:new Date(),rejectionReason:approve?null:reason!.trim()}});
  await tx.auditLog.create({data:{actorId,action:approve?'PAYMENT_APPROVED':'PAYMENT_REJECTED',resourceId:proof.id,details:{orderId:proof.orderId,reason:approve?null:reason!.trim()}}});
  await tx.notification.create({data:{userId:proof.order.buyerId,message:`Pesanan ${proof.orderId}: ${approve?'Pembayaran disetujui':`Ditolak: ${reason!.trim()}`}`}});
  await tx.outbox.create({data:{key:`payment-review:${proof.id}`,topic:'payment.reviewed',payload:{buyerId:proof.order.buyerId,orderId:proof.orderId,approved:approve,reason:approve?null:reason!.trim()}}});
  return {orderId:proof.orderId,status:approve?'PAID':'REJECTED',alreadyApplied:false};
 });
}
