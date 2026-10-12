import {z} from 'zod';import {db} from './db.js';import {infrastructureCheck} from './operations.js';import {settings} from './services.js';import {mediaBytes} from './media.js';
async function main(){
 await infrastructureCheck();
 const cfg=await settings();
 if(typeof cfg.name!=='string'||!cfg.name.trim())throw new Error('Nama website belum diset');
 if(typeof cfg.terms!=='string'||cfg.terms.trim().length<20)throw new Error('Syarat layanan belum diisi operator');
 if(typeof cfg.qris!=='string')throw new Error('QRIS belum diunggah');
 const media=await db.media.findFirst({where:{id:cfg.qris,public:true,mime:{startsWith:'image/'}}});if(!media)throw new Error('QRIS harus media gambar publik valid');await mediaBytes(media.key);
 const token=z.string().regex(/^\d{5,20}:[A-Za-z0-9_-]{30,}$/).safeParse(process.env.TELEGRAM_BOT_TOKEN);if(!token.success)throw new Error('Format token bot tidak valid');
 const rootId=z.string().regex(/^[1-9]\d{0,15}$/).safeParse(process.env.SUPER_ADMIN_TELEGRAM_ID);if(!rootId.success)throw new Error('Identitas Telegram root tidak valid');
 if(!await db.user.findFirst({where:{active:true,role:'SUPER_ADMIN',telegramId:rootId.data}}))throw new Error('Super Admin Telegram belum terikat');
 const backlog=await db.outbox.count({where:{sentAt:null,attempts:{gte:5}}});
 console.log(JSON.stringify({configurationCheck:'PASS',outboxRetryBacklog:backlog,telegramNetworkTest:'NOT_RUN',note:'Bukan bukti acceptance test atau keamanan produksi.'},null,2));
}
main().catch(error=>{console.error(`Readiness FAILED: ${error instanceof Error?error.message:'Unknown error'}`);process.exitCode=1;}).finally(()=>db.$disconnect());
