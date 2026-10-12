import express,{type Request,type Response,type NextFunction} from 'express';
import helmet from 'helmet';import cors from 'cors';import cookieParser from 'cookie-parser';import rateLimit from 'express-rate-limit';import multer from 'multer';
import argon2 from 'argon2';import {randomBytes,randomUUID} from 'node:crypto';import {z,ZodError} from 'zod';import pino from 'pino';
import {db,atomic,DomainError} from './db.js';import {origin} from './config.js';
import {session,requireOrigin,credentials,login,cookieName,cookieOptions,requestReset,resetPassword,hash} from './auth.js';
import {createOrder} from './orders.js';import {reviewPayment} from './payments.js';
import {saveMedia,mediaBytes} from './media.js';
import {requireAdmin,settings,setSetting,planInput,productInput,createProduct,addStock,submitProof,dashboard,decrypt,changeUser} from './services.js';
import {savePlan,savePromo,sendNotification,editProduct,reviewProduct} from './admin.js';
import {infrastructureCheck} from './operations.js';
export const app=express();const logger=pino();app.set('trust proxy','loopback');
app.use((req,res,next)=>{const requestId=randomUUID();const start=Date.now();res.setHeader('X-Request-ID',requestId);res.on('finish',()=>logger.info({requestId,method:req.method,route:req.route?.path??'unmatched',status:res.statusCode,durationMs:Date.now()-start},'HTTP request'));next();});
app.use(helmet());app.use(cors({origin,credentials:true}));app.use(express.json({limit:'64kb'}));app.use(cookieParser());
app.use(rateLimit({windowMs:60_000,limit:120,standardHeaders:'draft-7',legacyHeaders:false}));
app.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
const wrap=(fn:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{void fn(req,res).catch(next);};
const limit=rateLimit({windowMs:15*60_000,limit:10,standardHeaders:'draft-7',legacyHeaders:false});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:0,parts:1}}).single('file');
const pager=(req:Request)=>({take:50,skip:z.coerce.number().int().min(0).max(1000000).parse(req.query.offset??0)});
const guard=(admin=false)=>(req:Request,_res:Response,next:NextFunction)=>{void session(req,true).then(async s=>{if(admin)await requireAdmin(s.user.id,true);next();}).catch(next);};
app.get('/health',wrap(async(_req,res)=>{await db.$queryRaw`SELECT 1`;res.json({ok:true});}));
// Authenticated, potentially expensive checks are not a public health polling endpoint.
app.get('/admin/readiness',wrap(async(req,res)=>{const s=await session(req);await requireAdmin(s.user.id,true);try{res.json(await infrastructureCheck());}catch{throw new DomainError(503,'Pemeriksaan infrastruktur gagal; jalankan npm run readiness untuk diagnosis lokal');}}));
app.get('/public/settings',wrap(async(_req,res)=>{res.json(await settings());}));
app.get('/public/plans',wrap(async(_req,res)=>{res.json(await db.plan.findMany({where:{active:true},orderBy:{price:'asc'}}));}));
app.get('/public/products',wrap(async(req,res)=>{
 const cfg=await settings();if(cfg.maintenance===true)throw new DomainError(503,'Website dalam maintenance');
 const candidates=await db.product.findMany({where:{approved:true,active:true,seller:{active:true}},select:{id:true,title:true,description:true,category:true,price:true,stock:true,sellerId:true,seller:{select:{storeName:true,role:true}},createdAt:true},...pager(req),orderBy:{createdAt:'desc'}});
 // Filter expired reseller packages without exposing private user data.
 const now=new Date();const ids=candidates.filter(p=>p.seller.role==='RESELLER').map(p=>p.sellerId);
 const subs=await db.subscription.findMany({where:{userId:{in:ids},revoked:false,OR:[{expiresAt:null},{expiresAt:{gt:now}}]},select:{userId:true}});const active=new Set(subs.map(s=>s.userId));
 res.json(candidates.filter(p=>p.seller.role!=='RESELLER'||active.has(p.sellerId)).map(({sellerId, seller,...p})=>({...p,storeName:seller.storeName})));
}));
app.post('/auth/register',limit,wrap(async(req,res)=>{requireOrigin(req);const data=credentials.parse(req.body);await db.user.create({data:{email:data.email,passwordHash:await argon2.hash(data.password,{type:argon2.argon2id})}});res.status(201).json({ok:true});}));
app.post('/auth/login',limit,wrap(login));app.post('/auth/reset/request',limit,wrap(requestReset));app.post('/auth/reset/confirm',limit,wrap(resetPassword));
app.get('/auth/me',wrap(async(req,res)=>{const s=await session(req);res.json({user:{id:s.user.id,email:s.user.email,role:s.user.role,displayName:s.user.displayName,storeName:s.user.storeName,telegramLinked:!!s.user.telegramId},csrfToken:s.csrfToken});}));
app.post('/auth/logout',wrap(async(req,res)=>{const s=await session(req,true);await db.session.deleteMany({where:{id:s.id}});res.clearCookie(cookieName,cookieOptions).json({ok:true});}));
app.patch('/profile',wrap(async(req,res)=>{const s=await session(req,true);const data=z.object({displayName:z.string().trim().max(100),storeName:z.string().trim().max(100)}).strict().parse(req.body);await db.user.update({where:{id:s.user.id},data});res.json({ok:true});}));
app.post('/profile/telegram-link',wrap(async(req,res)=>{const s=await session(req,true);const token=randomBytes(24).toString('hex');await db.telegramLink.create({data:{userId:s.user.id,tokenHash:hash(token),expiresAt:new Date(Date.now()+10*60_000)}});res.json({command:`/link ${token}`,expiresInSeconds:600});}));
app.post('/orders',wrap(async(req,res)=>{const s=await session(req,true);res.status(201).json(await createOrder(s.user.id,req.body));}));
app.get('/orders',wrap(async(req,res)=>{const s=await session(req);res.json(await db.order.findMany({where:{buyerId:s.user.id},include:{items:true,proofs:{select:{id:true,status:true,version:true,rejectionReason:true}}},...pager(req),orderBy:{createdAt:'desc'}}));}));
app.get('/orders/:id',wrap(async(req,res)=>{const s=await session(req);const order=await db.order.findFirst({where:{id:req.params.id,buyerId:s.user.id},include:{items:true,proofs:{select:{id:true,status:true,version:true,rejectionReason:true}}}});if(!order)throw new DomainError(404,'Pesanan tidak ditemukan');
 const units=order.status==='PAID'?await db.digitalUnit.findMany({where:{deliveredOrderId:order.id,deliveredBuyerId:s.user.id},select:{id:true,productId:true,ciphertext:true}}):[];res.json({...order,delivery:units.map(u=>({id:u.id,productId:u.productId,value:decrypt(u.ciphertext)}))});}));
app.post('/orders/:id/proof',guard(),upload,wrap(async(req,res)=>{const s=await session(req,true);if(!req.file)throw new DomainError(400,'File diperlukan');
 if(!await db.order.findFirst({where:{id:req.params.id,buyerId:s.user.id,status:{in:['AWAITING_PAYMENT','REJECTED']}}}))throw new DomainError(409,'Pesanan tidak menerima bukti');
 const media=await saveMedia(s.user.id,req.file.buffer,req.file.originalname,req.file.mimetype);res.status(201).json(await submitProof(s.user.id,req.params.id,media.id));}));
app.get('/media/:id',wrap(async(req,res)=>{const media=await db.media.findUnique({where:{id:req.params.id}});if(!media)throw new DomainError(404,'Media tidak ditemukan');
 if(!media.public){const s=await session(req);if(s.user.id!==media.ownerId&&!['ADMIN','SUPER_ADMIN'].includes(s.user.role))throw new DomainError(404,'Media tidak ditemukan');}
 res.setHeader('Content-Type',media.mime);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'");
 res.setHeader('Content-Disposition',`${!media.public?'attachment':'inline'}; filename="${media.key}"`);res.send(await mediaBytes(media.key));}));
app.get('/notifications',wrap(async(req,res)=>{const s=await session(req);res.json(await db.notification.findMany({where:{userId:s.user.id},...pager(req),orderBy:{createdAt:'desc'}}));}));
app.post('/notifications/:id/read',wrap(async(req,res)=>{const s=await session(req,true);await db.notification.updateMany({where:{id:req.params.id,userId:s.user.id},data:{readAt:new Date()}});res.json({ok:true});}));
app.get('/dashboard',wrap(async(req,res)=>{const s=await session(req);res.json(await dashboard(s.user.id));}));
// A connection ends after the session expires; every tick revalidates user/session.
app.get('/dashboard/events',wrap(async(req,res)=>{await session(req);res.setHeader('Content-Type','text/event-stream');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();let busy=false;
 const tick=async()=>{if(busy)return;busy=true;try{const s=await session(req);res.write(`data: ${JSON.stringify(await dashboard(s.user.id))}\n\n`);}catch{res.end();}finally{busy=false;}};
 const timer=setInterval(()=>{void tick();},10000);res.on('close',()=>clearInterval(timer));await tick();}));
app.get('/reseller/products',wrap(async(req,res)=>{const s=await session(req);res.json(await db.product.findMany({where:{sellerId:s.user.id},...pager(req),orderBy:{createdAt:'desc'}}));}));
app.post('/reseller/products',wrap(async(req,res)=>{const s=await session(req,true);res.status(201).json(await createProduct(s.user.id,req.body));}));
app.patch('/reseller/products/:id',wrap(async(req,res)=>{const s=await session(req,true);res.json(await editProduct(s.user.id,req.params.id,req.body));}));
app.post('/reseller/products/:id/stock',wrap(async(req,res)=>{const s=await session(req,true);res.json(await addStock(s.user.id,req.params.id,req.body.units));}));
app.get('/reseller/ledger',wrap(async(req,res)=>{const s=await session(req);res.json(await db.commission.findMany({where:{sellerId:s.user.id},...pager(req),orderBy:{createdAt:'desc'}}));}));
app.get('/reseller/sales',wrap(async(req,res)=>{const s=await session(req);res.json(await db.orderItem.findMany({where:{sellerIdSnapshot:s.user.id,order:{status:'PAID'}},select:{id:true,orderId:true,titleSnapshot:true,priceSnapshot:true,quantity:true,commission:true},...pager(req),orderBy:{id:'desc'}}));}));
app.get('/admin/users',wrap(async(req,res)=>{const s=await session(req);await requireAdmin(s.user.id);res.json(await db.user.findMany({...pager(req),orderBy:{createdAt:'desc'},select:{id:true,email:true,role:true,active:true,storeName:true,createdAt:true}}));}));
app.patch('/admin/users/:id',wrap(async(req,res)=>{const s=await session(req,true);res.json(await changeUser(s.user.id,req.params.id,req.body));}));
app.get('/admin/products',wrap(async(req,res)=>{const s=await session(req);await requireAdmin(s.user.id);res.json(await db.product.findMany({...pager(req),orderBy:{createdAt:'desc'}}));}));
app.post('/admin/products/:id/review',wrap(async(req,res)=>{const s=await session(req,true);res.json(await reviewProduct(s.user.id,req.params.id,req.body));}));
app.get('/admin/orders',wrap(async(req,res)=>{const s=await session(req);await requireAdmin(s.user.id);res.json(await db.order.findMany({...pager(req),orderBy:{createdAt:'desc'},include:{items:true,proofs:{orderBy:{version:'desc'}}}}));}));
app.get('/admin/proofs/:id/media',wrap(async(req,res)=>{const s=await session(req);await requireAdmin(s.user.id);const proof=await db.paymentProof.findUniqueOrThrow({where:{id:req.params.id}});const media=await db.media.findUniqueOrThrow({where:{key:proof.storageKey}});res.json({id:media.id,mime:media.mime});}));
app.post('/admin/payment-proofs/:id/review',wrap(async(req,res)=>{const s=await session(req,true);const input=z.discriminatedUnion('approve',[z.object({approve:z.literal(true)}).strict(),z.object({approve:z.literal(false),reason:z.string().trim().min(3).max(1000)}).strict()]).parse(req.body);res.json(await reviewPayment(s.user.id,req.params.id,input.approve,'reason'in input?input.reason:undefined));}));
app.patch('/admin/settings/:key',wrap(async(req,res)=>{const s=await session(req,true);res.json(await setSetting(s.user.id,req.params.key,req.body.value));}));
app.post('/admin/media',guard(true),upload,wrap(async(req,res)=>{const s=await session(req,true);if(!req.file)throw new DomainError(400,'File diperlukan');res.status(201).json(await saveMedia(s.user.id,req.file.buffer,req.file.originalname,req.file.mimetype,true));}));
app.get('/admin/plans',wrap(async(req,res)=>{const s=await session(req);await requireAdmin(s.user.id);res.json(await db.plan.findMany({orderBy:{price:'asc'}}));}));
app.post('/admin/plans',wrap(async(req,res)=>{const s=await session(req,true);res.status(201).json(await savePlan(s.user.id,req.body));}));
app.patch('/admin/plans/:id',wrap(async(req,res)=>{const s=await session(req,true);res.json(await savePlan(s.user.id,req.body,req.params.id));}));
app.get('/admin/promos',wrap(async(req,res)=>{const s=await session(req);await requireAdmin(s.user.id);res.json(await db.promo.findMany({...pager(req)}));}));
app.post('/admin/promos',wrap(async(req,res)=>{const s=await session(req,true);res.json(await savePromo(s.user.id,req.body));}));
app.get('/admin/ledger',wrap(async(req,res)=>{const s=await session(req);await requireAdmin(s.user.id);res.json(await db.commission.findMany({...pager(req),orderBy:{createdAt:'desc'}}));}));
app.get('/admin/audit',wrap(async(req,res)=>{const s=await session(req);await requireAdmin(s.user.id);res.json(await db.auditLog.findMany({...pager(req),orderBy:{createdAt:'desc'}}));}));
app.post('/admin/notifications',wrap(async(req,res)=>{const s=await session(req,true);res.json(await sendNotification(s.user.id,req.body));}));
app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
 if(error instanceof ZodError){res.status(400).json({error:'Input tidak valid',issues:error.issues});return;}
 if(error instanceof DomainError){res.status(error.status).json({error:error.message});return;}
 if(error instanceof multer.MulterError){res.status(400).json({error:'Upload tidak valid atau terlalu besar'});return;}
 if(typeof error==='object'&&error&&'code'in error){if(error.code==='P2002'){res.status(409).json({error:'Data atau request key sudah ada'});return;}if(error.code==='P2025'){res.status(404).json({error:'Data tidak ditemukan'});return;}}
 logger.error({errorType:error instanceof Error?error.name:'Unknown'},'Request gagal');res.status(500).json({error:'Kesalahan internal'});
});
