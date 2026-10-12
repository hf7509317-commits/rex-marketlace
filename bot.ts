import {Telegraf,Markup,Input,type Context} from 'telegraf';import {z} from 'zod';import pino from 'pino';
import {db,atomic,DomainError} from './db.js';import {hash} from './auth.js';import {saveMedia,mediaBytes} from './media.js';
import {reviewPayment} from './payments.js';import {savePlan,savePromo,sendNotification,reviewProduct} from './admin.js';import {requireAdmin,dashboard,settings,setSetting,planInput,changeUser} from './services.js';
const config=z.object({TELEGRAM_BOT_TOKEN:z.string().regex(/^\d{5,20}:[A-Za-z0-9_-]{30,}$/),SUPER_ADMIN_TELEGRAM_ID:z.string().regex(/^[1-9]\d{0,15}$/)}).parse(process.env);
const bot=new Telegraf(config.TELEGRAM_BOT_TOKEN);const logger=pino();
// Telegram bot is a single long-polling process. Private chats only.
async function actor(ctx:Context,superOnly=false){
 if(!ctx.from||!ctx.chat||ctx.chat.type!=='private'||String(ctx.chat.id)!==String(ctx.from.id))throw new DomainError(403,'Gunakan private chat');
 const u=await db.user.findUnique({where:{telegramId:String(ctx.from.id)}});
 if(!u?.active||!['ADMIN','SUPER_ADMIN'].includes(u.role))throw new DomainError(403,'Akun Telegram belum terikat Admin');
 if(u.role==='SUPER_ADMIN'&&String(ctx.from.id)!==config.SUPER_ADMIN_TELEGRAM_ID)throw new DomainError(403,'Identitas Super Admin tidak cocok');
 await requireAdmin(u.id,superOnly);return u;
}
const menu=()=>Markup.inlineKeyboard([
 [Markup.button.callback('Dashboard','menu:dashboard'),Markup.button.callback('Pengaturan Website','menu:settings')],
 [Markup.button.callback('Reseller','menu:users'),Markup.button.callback('Produk','menu:products')],
 [Markup.button.callback('Pesanan / QRIS','menu:orders'),Markup.button.callback('Komisi','menu:ledger')],
 [Markup.button.callback('Paket Reseller','menu:plans'),Markup.button.callback('Promo','menu:promos')],
 [Markup.button.callback('Notifikasi','menu:notifications')],
 [Markup.button.callback('Log Aktivitas','menu:audit'),Markup.button.callback('Bantuan','menu:help')]
]);
function key(ctx:Context){return `${ctx.from!.id}:${ctx.chat!.id}`;}
async function conversation(ctx:Context,actorId:string,action:string,payload:Record<string,string>){
 await db.botConversation.upsert({where:{key:key(ctx)},create:{key:key(ctx),actorId,action,payload,expiresAt:new Date(Date.now()+5*60_000)},update:{actorId,action,payload,expiresAt:new Date(Date.now()+5*60_000)}});
}
const help=`Perintah:\n/menu\n/set namaSetting JSON (Super Admin)\n/media logo|banner|qris lalu kirim gambar\n/plan JSON (id opsional untuk edit)\n/user ID ROLE true|false\n/promo KODE PERSEN ISO_DATE true|false\n/notify USER_ID pesan\n/list users|products|orders|ledger|audit OFFSET\n/cancel\nSetelan: name, terms, maintenance, categories, logo, banner, qris. Semua perubahan diperiksa role. Percakapan berlaku 5 menit.`;
bot.use(async(ctx,next)=>{
 // Always acknowledge every callback, including unauthorized or expired ones.
 if(ctx.callbackQuery)await ctx.answerCbQuery().catch(()=>{});
 try{await next();}catch(error){logger.warn({errorType:error instanceof Error?error.name:'Unknown'},'Bot request gagal');await ctx.reply(error instanceof DomainError?error.message:error instanceof z.ZodError?'Input tidak valid':'Operasi gagal; cek konfigurasi/log tanpa membagikan token.').catch(()=>{});}
});
bot.command('link',async ctx=>{
 if(ctx.chat.type!=='private')throw new DomainError(403,'Gunakan private chat');
 const token=ctx.message.text.split(/\s+/)[1];if(!token||!/^[a-f0-9]{48}$/.test(token))throw new DomainError(400,'Gunakan kode dari profil website');
 await atomic(async tx=>{
  const link=await tx.telegramLink.findUnique({where:{tokenHash:hash(token)}});if(!link||link.expiresAt<=new Date())throw new DomainError(400,'Kode tidak valid/kedaluwarsa');
  const u=await tx.user.findUniqueOrThrow({where:{id:link.userId}});
  if(!u.active)throw new DomainError(403,'Akun tidak aktif');
  if((String(ctx.from.id)===config.SUPER_ADMIN_TELEGRAM_ID)!==(u.role==='SUPER_ADMIN'))throw new DomainError(403,'Akun tidak sesuai identitas Super Admin');
  await tx.user.update({where:{id:u.id},data:{telegramId:String(ctx.from.id)}});await tx.telegramLink.deleteMany({where:{userId:u.id}});
 });await ctx.reply('Telegram terhubung. Customer menerima notifikasi pembayaran; Admin dapat memakai /menu.');
});
bot.start(async ctx=>{await ctx.reply('REXMARKET. Hubungkan akun dengan /link KODE dari profil website. Admin: /menu.');});
bot.command('menu',async ctx=>{await actor(ctx);await ctx.reply('Menu REXMARKET',menu());});
bot.command('help',async ctx=>{await actor(ctx);await ctx.reply(help);});
bot.command('cancel',async ctx=>{await actor(ctx);await db.botConversation.deleteMany({where:{key:key(ctx)}});await ctx.reply('Percakapan dibatalkan.');});
async function list(ctx:Context,kind:string,offset=0){
 const u=await actor(ctx);const opts={skip:offset,take:10};let rows:unknown;
 if(kind==='users')rows=await db.user.findMany({...opts,orderBy:{createdAt:'desc'},select:{id:true,email:true,role:true,active:true}});
 else if(kind==='products'){
  await ctx.reply(`Daftar produk offset ${offset}, maksimum 10. Berikutnya: /list products ${offset+10}`);
  const products=await db.product.findMany({...opts,orderBy:{createdAt:'desc'}});
  for(const p of products)await ctx.reply(`${p.id}\n${p.title}\nRp ${p.price} | stok ${p.stock} | approved=${p.approved}`,Markup.inlineKeyboard([[Markup.button.callback('Approve',`product:y:${p.id}`),Markup.button.callback('Unapprove',`product:n:${p.id}`)]]));return;
 }else if(kind==='orders'){
  await ctx.reply(`Daftar pesanan offset ${offset}, maksimum 10. Berikutnya: /list orders ${offset+10}`);
  const orders=await db.order.findMany({...opts,orderBy:{createdAt:'desc'},include:{proofs:{orderBy:{version:'desc'},take:1}}});
  for(const o of orders){const proof=o.proofs[0];await ctx.reply(`${o.id}\n${o.kind} Rp ${o.total} ${o.status}`,proof?Markup.inlineKeyboard([[Markup.button.callback('Lihat bukti',`proof:${proof.id}`)]]):undefined);}return;
 }else if(kind==='ledger')rows=await db.commission.findMany({...opts,orderBy:{createdAt:'desc'}});
 else if(kind==='audit')rows=await db.auditLog.findMany({...opts,orderBy:{createdAt:'desc'}});
 else throw new DomainError(400,'Jenis daftar tidak dikenal');
 await ctx.reply(JSON.stringify(rows,null,2).slice(0,3800)||'Kosong');await ctx.reply(`Halaman offset ${offset}, maksimum 10. Berikutnya: /list ${kind} ${offset+10}.`);void u;
}
bot.command('list',async ctx=>{const parts=ctx.message.text.split(/\s+/);await list(ctx,z.enum(['users','products','orders','ledger','audit']).parse(parts[1]),z.coerce.number().int().min(0).max(1000000).parse(parts[2]??0));});
bot.action(/^menu:(\w+)$/,async ctx=>{
 const u=await actor(ctx);const section=ctx.match[1];
 if(section==='dashboard')await ctx.reply(JSON.stringify(await dashboard(u.id),null,2).slice(0,3800));
 else if(section==='settings')await ctx.reply(`${JSON.stringify(await settings(),null,2).slice(0,2500)}\n\n${help}`);
 else if(['users','products','orders','ledger','audit'].includes(section))await list(ctx,section);
 else if(section==='plans')await ctx.reply(`${JSON.stringify(await db.plan.findMany({take:10,orderBy:{price:'asc'}}),null,2).slice(0,3000)}\n/plan JSON untuk tambah atau edit (sertakan id untuk edit). Super Admin saja.`);
 else if(section==='promos')await ctx.reply(`${JSON.stringify(await db.promo.findMany({take:10}),null,2).slice(0,3000)}\n/promo KODE PERSEN ISO_DATE true|false`);
 else if(section==='notifications')await ctx.reply('Kirim notifikasi in-app ke akun tertentu: /notify USER_ID pesan. Tidak melakukan broadcast massal.');
 else await ctx.reply(help);
});
async function sendProof(chatId:number|string,proofId:string){
 const proof=await db.paymentProof.findUniqueOrThrow({where:{id:proofId},include:{order:true}});
 const media=await db.media.findUniqueOrThrow({where:{key:proof.storageKey}});
 await bot.telegram.sendDocument(chatId,Input.fromBuffer(await mediaBytes(media.key),media.key),{caption:`Bukti ${proof.id} v${proof.version}\nOrder ${proof.orderId}\nRp ${proof.order.total}\n${proof.status}`,reply_markup:Markup.inlineKeyboard([[Markup.button.callback('APPROVE',`pay:y:${proof.id}`),Markup.button.callback('UNAPPROVE',`pay:n:${proof.id}`)]]).reply_markup});
}
bot.action(/^proof:([a-z0-9]+)$/,async ctx=>{await actor(ctx);await sendProof(ctx.chat!.id,ctx.match[1]);});
bot.action(/^pay:([yn]):([a-z0-9]+)$/,async ctx=>{
 const u=await actor(ctx);if(ctx.match[1]==='y'){const result=await reviewPayment(u.id,ctx.match[2],true);await ctx.reply(`Order ${result.orderId}: ${result.status}${result.alreadyApplied?' (sudah diterapkan)':''}`);}
 else{await conversation(ctx,u.id,'reject',{proofId:ctx.match[2]});await ctx.reply('Kirim alasan penolakan (3–1000 karakter). Berlaku 5 menit; /cancel untuk batal.');}
});
bot.action(/^product:([yn]):([a-z0-9]+)$/,async ctx=>{const u=await actor(ctx);const product=await db.product.findUniqueOrThrow({where:{id:ctx.match[2]}});await reviewProduct(u.id,product.id,{approved:ctx.match[1]==='y',active:product.active});await ctx.reply('Status persetujuan produk diperbarui.');});
bot.command('set',async ctx=>{const u=await actor(ctx,true);const match=ctx.message.text.match(/^\/set(?:@\w+)?\s+(\w+)\s+([\s\S]+)$/);if(!match)throw new DomainError(400,'Format /set KEY JSON');await setSetting(u.id,match[1],JSON.parse(match[2]));await ctx.reply('Pengaturan tersimpan.');});
bot.command('media',async ctx=>{const u=await actor(ctx,true);const field=z.enum(['logo','banner','qris']).parse(ctx.message.text.split(/\s+/)[1]);await conversation(ctx,u.id,'media',{field});await ctx.reply(`Kirim gambar ${field} sebagai document (JPG/PNG/WebP), maksimum 5 MB. Foto juga diterima.`);});
bot.command('plan',async ctx=>{const u=await actor(ctx,true);const raw=JSON.parse(ctx.message.text.replace(/^\/plan(?:@\w+)?\s+/,''));const {id,...rest}=raw;const data=planInput.parse(rest);await savePlan(u.id,data,id?z.string().cuid().parse(id):undefined);await ctx.reply('Paket tersimpan.');});
bot.command('user',async ctx=>{const u=await actor(ctx,true);const [,id,role,active]=ctx.message.text.split(/\s+/);if(!['true','false'].includes(active))throw new DomainError(400,'active harus true/false');await changeUser(u.id,id,{role,active:active==='true'});await ctx.reply('Akun diperbarui.');});
bot.command('promo',async ctx=>{const u=await actor(ctx,true);const [,code,percent,date,active]=ctx.message.text.split(/\s+/);const data=z.object({code:z.string().regex(/^[A-Z0-9_-]{2,40}$/),percent:z.coerce.number().int().min(1).max(90),expiresAt:z.coerce.date(),active:z.enum(['true','false']).transform(v=>v==='true')}).parse({code,percent,expiresAt:date,active});await savePromo(u.id,data);await ctx.reply('Promo tersimpan.');});
bot.command('notify',async ctx=>{const u=await actor(ctx);const match=ctx.message.text.match(/^\/notify(?:@\w+)?\s+([a-z0-9]+)\s+([\s\S]+)$/);if(!match)throw new DomainError(400,'Format /notify USER_ID pesan');const message=z.string().min(1).max(2000).parse(match[2]);await sendNotification(u.id,{userId:match[1],message});await ctx.reply('Notifikasi in-app dibuat.');});
async function telegramFile(fileId:string){
 const url=await bot.telegram.getFileLink(fileId);if(url.protocol!=='https:'||url.hostname!=='api.telegram.org'||!url.pathname.startsWith(`/file/bot${config.TELEGRAM_BOT_TOKEN}/`))throw new DomainError(400,'URL file Telegram tidak valid');
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok||!response.body)throw new DomainError(502,'Tidak bisa mengunduh file');
 const reader=response.body.getReader();const chunks:Buffer[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>5*1024*1024)throw new DomainError(400,'File >5 MB');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}return Buffer.concat(chunks);
}
bot.on('message',async ctx=>{
 const u=await actor(ctx);const state=await db.botConversation.findUnique({where:{key:key(ctx)}});
 if(!state||state.actorId!==u.id||state.expiresAt<=new Date()){await db.botConversation.deleteMany({where:{key:key(ctx)}});await ctx.reply('Tidak ada percakapan aktif. Gunakan /menu.');return;}
 const payload=z.record(z.string()).parse(state.payload);
 if(state.action==='reject'&&'text'in ctx.message){await reviewPayment(u.id,payload.proofId,false,ctx.message.text);await db.botConversation.deleteMany({where:{key:key(ctx)}});await ctx.reply('Pembayaran ditolak; alasan tersimpan.');}
 else if(state.action==='media'){
  await actor(ctx,true);let fileId:string;let name:string;let mime:string;
  if('document'in ctx.message){fileId=ctx.message.document.file_id;name=ctx.message.document.file_name??'';mime=ctx.message.document.mime_type??'';if((ctx.message.document.file_size??0)>5*1024*1024)throw new DomainError(400,'File >5 MB');}
  else if('photo'in ctx.message){fileId=ctx.message.photo.at(-1)!.file_id;name='photo.jpg';mime='image/jpeg';}
  else throw new DomainError(400,'Kirim gambar');
  const media=await saveMedia(u.id,await telegramFile(fileId),name,mime,true);await setSetting(u.id,payload.field,media.id);await db.botConversation.deleteMany({where:{key:key(ctx)}});await ctx.reply('Media website diperbarui.');
 }else throw new DomainError(400,'Jenis pesan tidak sesuai');
});
// At-least-once delivery: payments stay atomic even if Telegram is unavailable.
// A process crash after send but before sentAt can duplicate a notification, never a payment.
let working=false;
async function drain(){if(working)return;working=true;try{
 const jobs=await db.outbox.findMany({where:{sentAt:null,OR:[{lockedUntil:null},{lockedUntil:{lt:new Date()}}]},orderBy:{createdAt:'asc'},take:10});
 for(const job of jobs){const claim=await db.outbox.updateMany({where:{id:job.id,sentAt:null,OR:[{lockedUntil:null},{lockedUntil:{lt:new Date()}}]},data:{lockedUntil:new Date(Date.now()+120000),attempts:{increment:1}}});if(!claim.count)continue;
  try{
   const payload=z.record(z.unknown()).parse(job.payload);
   if(job.topic==='payment.submitted'){
    const admins=await db.user.findMany({where:{active:true,role:{in:['ADMIN','SUPER_ADMIN']},telegramId:{not:null}},select:{telegramId:true,role:true}});
    const valid=admins.filter(a=>a.role!=='SUPER_ADMIN'||a.telegramId===config.SUPER_ADMIN_TELEGRAM_ID);if(!valid.length)throw new Error('No linked admin');
    for(const admin of valid)await sendProof(admin.telegramId!,z.string().parse(payload.proofId));
   }else if(job.topic==='payment.reviewed'){
    const user=await db.user.findUnique({where:{id:z.string().parse(payload.buyerId)}});
    if(user?.active&&user.telegramId)await bot.telegram.sendMessage(user.telegramId,`Pesanan ${payload.orderId}: ${payload.approved?'disetujui':`ditolak. ${payload.reason}`}. Lihat detail/delivery di website.`);
   }else throw new Error('Unknown topic');
   await db.outbox.update({where:{id:job.id},data:{sentAt:new Date(),lockedUntil:null,lastError:null}});
  }catch{await db.outbox.update({where:{id:job.id},data:{lastError:'Delivery failed; inspect configuration',lockedUntil:new Date(Date.now()+Math.min(3600000,10000*2**Math.min(job.attempts,8)))}});}
 }
}catch{logger.warn('Outbox scan gagal');}finally{working=false;}}
bot.catch(()=>logger.warn('Telegram transport gagal'));
// Fail early if root bootstrap/link is missing; do not silently invent a bot principal.
const root=await db.user.findFirst({where:{role:'SUPER_ADMIN',active:true,telegramId:config.SUPER_ADMIN_TELEGRAM_ID}});
if(!root)throw new Error('Bootstrap Super Admin dengan SUPER_ADMIN_TELEGRAM_ID sebelum menyalakan bot');
await bot.telegram.getMe();
const timer=setInterval(()=>{void drain();},5000);
void bot.launch({dropPendingUpdates:false}).catch(()=>{logger.error('Polling gagal');process.exitCode=1;clearInterval(timer);});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{clearInterval(timer);bot.stop(signal);void db.$disconnect();});
