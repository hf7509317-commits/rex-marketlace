import {randomUUID} from 'node:crypto';import {mkdir,writeFile,unlink,stat} from 'node:fs/promises';import {join} from 'node:path';
import {db} from './db.js';import {env,storageRoot} from './config.js';
export async function infrastructureCheck(){
 await db.$queryRaw`SELECT 1`;
 // This also detects a DB with missing schema migrations.
 await db.outbox.count();await db.auditLog.count();await db.media.count();
 await mkdir(storageRoot,{recursive:true,mode:0o700});
 const info=await stat(storageRoot);if(!info.isDirectory()||(info.mode&0o077)!==0)throw new Error('Storage harus direktori privat mode 0700');
 const probe=join(storageRoot,`.probe-${randomUUID()}`);
 await writeFile(probe,'probe',{flag:'wx',mode:0o600});await unlink(probe);
 const invalid=await db.$queryRaw<Array<{count:bigint}>>`
   SELECT COUNT(*) AS count FROM "Product" p
   WHERE p."stock" <> (SELECT COUNT(*) FROM "DigitalUnit" d WHERE d."productId"=p."id" AND d."consumed"=false)
 `;
 if(Number(invalid[0].count)!==0)throw new Error('Stok produk dan unit digital tidak konsisten');
 const migrations=await db.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*) AS count FROM "_prisma_migrations" WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL`;
 if(Number(migrations[0].count))throw new Error('Ada migrasi belum selesai');
 return {ok:true,environment:env.NODE_ENV};
}
export async function cleanExpiredAuth(){
 const now=new Date();
 await db.$transaction([
  db.session.deleteMany({where:{expiresAt:{lt:now}}}),
  db.passwordReset.deleteMany({where:{expiresAt:{lt:now}}}),
  db.telegramLink.deleteMany({where:{expiresAt:{lt:now}}}),
  db.botConversation.deleteMany({where:{expiresAt:{lt:now}}}),
  db.loginThrottle.deleteMany({where:{windowStart:{lt:new Date(Date.now()-24*3600000)}}})
 ]);
 // Audit, financial ledger and proof files are deliberately never deleted here.
}
