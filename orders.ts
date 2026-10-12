import { z } from 'zod';
import { atomic, DomainError } from './db.js';
import { subscription } from './services.js';
const inputSchema=z.object({requestKey:z.string().uuid(),planId:z.string().cuid().optional(),items:z.array(z.object({productId:z.string().cuid(),quantity:z.number().int().min(1).max(100)}).strict()).max(20).default([]),promoCode:z.string().trim().max(40).optional()}).strict();
export async function createOrder(userId:string,raw:unknown) {
 const input=inputSchema.parse(raw);
 if ((!!input.planId && input.items.length>0)||(!input.planId && !input.items.length)) throw new DomainError(400,'Pilih paket ATAU produk');
 if (new Set(input.items.map(i=>i.productId)).size!==input.items.length) throw new DomainError(400,'Produk duplikat');
 return atomic(async tx=>{
  if ((await tx.setting.findUnique({where:{key:'maintenance'}}))?.value===true) throw new DomainError(503,'Website sedang maintenance');
  const user=await tx.user.findUnique({where:{id:userId}});if(!user?.active)throw new DomainError(403,'Akun tidak aktif');
  const prior=await tx.order.findUnique({where:{buyerId_requestKey:{buyerId:userId,requestKey:input.requestKey}},include:{items:true}});
  if(prior){
   const same=prior.planId===(input.planId??null)&&prior.promoCode===(input.promoCode??null)&&prior.items.length===input.items.length&&input.items.every(i=>prior.items.some(p=>p.productId===i.productId&&p.quantity===i.quantity));
   if(!same)throw new DomainError(409,'Request key untuk pesanan berbeda');return prior;
  }
  if(input.planId){
   if(input.promoCode)throw new DomainError(400,'Promo hanya untuk produk');
   if(!['CUSTOMER','RESELLER'].includes(user.role))throw new DomainError(400,'Admin tidak perlu paket reseller');
   const plan=await tx.plan.findFirst({where:{id:input.planId,active:true}});if(!plan)throw new DomainError(404,'Paket tidak tersedia');
   return tx.order.create({data:{buyerId:userId,requestKey:input.requestKey,kind:'PLAN',planId:plan.id,planSnapshot:{name:plan.name,durationDays:plan.durationDays,productLimit:plan.productLimit,platformFeeBps:plan.platformFeeBps},total:plan.price}});
  }
  let discount=0;
  if(input.promoCode){const promo=await tx.promo.findFirst({where:{code:input.promoCode,active:true,expiresAt:{gt:new Date()}}});if(!promo)throw new DomainError(400,'Promo tidak aktif');discount=promo.percent;}
  const snapshots=[];
  for(const item of input.items){
   const p=await tx.product.findFirst({where:{id:item.productId,approved:true,active:true},include:{seller:true}});
   if(!p||!p.seller.active||p.stock<item.quantity)throw new DomainError(409,'Produk tidak tersedia');
   if(p.seller.role==='RESELLER'&&!await subscription(p.sellerId,tx))throw new DomainError(409,'Paket penjual tidak aktif');
   if(p.sellerId===userId)throw new DomainError(400,'Tidak bisa membeli produk sendiri');
   const sub=await subscription(p.sellerId,tx);
   snapshots.push({productId:p.id,sellerIdSnapshot:p.sellerId,titleSnapshot:p.title,priceSnapshot:Math.max(1,Math.floor(p.price*(100-discount)/100)),platformFeeBpsSnapshot:sub?.platformFeeBps??p.platformFeeBps,quantity:item.quantity});
  }
  const total=snapshots.reduce((n,i)=>n+i.priceSnapshot*i.quantity,0);
  if(!Number.isSafeInteger(total)||total<=0||total>2147483647)throw new DomainError(400,'Total tidak valid');
  return tx.order.create({data:{buyerId:userId,requestKey:input.requestKey,promoCode:input.promoCode,total,items:{create:snapshots}},include:{items:true}});
 });
}
