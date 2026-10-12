import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { type Request, type Response } from 'express';
import argon2 from 'argon2';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { db, atomic, DomainError } from './db.js';
import { env, origin } from './config.js';
export const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const secure=env.NODE_ENV==='production';export const cookieName=secure?'__Host-rexsession':'rexsession';
export const cookieOptions={httpOnly:true,secure,sameSite:'strict' as const,path:'/'};
export const credentials=z.object({email:z.string().email().max(254).transform(s=>s.toLowerCase()),password:z.string().min(12).max(128)}).strict();
export function requireOrigin(req:Request){if(req.get('origin')!==origin)throw new DomainError(403,'Origin tidak diizinkan');}
export async function session(req:Request,write=false){
 const token=req.cookies[cookieName];if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw new DomainError(401,'Login diperlukan');
 const record=await db.session.findUnique({where:{tokenHash:hash(token)},include:{user:true}});
 if(!record||record.expiresAt<=new Date()||!record.user.active)throw new DomainError(401,'Session tidak valid');
 if(write){requireOrigin(req);const a=Buffer.from(req.get('x-csrf-token')??'');const b=Buffer.from(record.csrfToken);if(a.length!==b.length||!timingSafeEqual(a,b))throw new DomainError(403,'CSRF token tidak valid');}
 return record;
}
const dummyHash=await argon2.hash(randomBytes(32),{type:argon2.argon2id});
export async function login(req:Request,res:Response){
 requireOrigin(req);const data=credentials.parse(req.body);const key=hash(data.email);
 // Every attempt consumes persistent per-account budget, even while requests overlap.
 await atomic(async tx=>{
  const old=await tx.loginThrottle.findUnique({where:{key}});const fresh=!old||old.windowStart.getTime()<Date.now()-15*60_000;
  if(!fresh&&old.failures>=10)throw new DomainError(429,'Terlalu banyak percobaan. Coba lagi 15 menit setelah percobaan pertama.');
  await tx.loginThrottle.upsert({where:{key},create:{key,failures:1},update:fresh?{failures:1,windowStart:new Date()}:{failures:{increment:1}}});
 });
 const user=await db.user.findUnique({where:{email:data.email}});
 const valid=await argon2.verify(user?.passwordHash??dummyHash,data.password);
 if(!user?.active||!valid)throw new DomainError(401,'Email atau password tidak valid');
 const token=randomBytes(32).toString('hex');const csrfToken=randomBytes(32).toString('hex');const expiresAt=new Date(Date.now()+8*60*60_000);
 await db.session.create({data:{userId:user.id,tokenHash:hash(token),csrfToken,expiresAt}});
 res.cookie(cookieName,token,{...cookieOptions,expires:expiresAt});res.json({user:{id:user.id,email:user.email,role:user.role},csrfToken});
}
function mailer(){
 if(!process.env.SMTP_HOST||!process.env.SMTP_FROM)throw new DomainError(503,'Reset password belum dikonfigurasi');
 return nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='true',requireTLS:process.env.SMTP_SECURE!=='true',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}:undefined});
}
export async function requestReset(req:Request,res:Response){
 requireOrigin(req);const transport=mailer();const email=z.object({email:z.string().email().max(254)}).strict().parse(req.body).email.toLowerCase();const user=await db.user.findUnique({where:{email}});
 if(user?.active){const token=randomBytes(32).toString('hex');const record=await db.passwordReset.create({data:{userId:user.id,tokenHash:hash(token),expiresAt:new Date(Date.now()+20*60_000)}});
  try{await transport.sendMail({from:process.env.SMTP_FROM,to:user.email,subject:'Reset password REXMARKET',text:`Buka ${origin}/?reset=${token}\nBerlaku 20 menit. Abaikan jika bukan permintaan Anda.`});}
  catch{await db.passwordReset.delete({where:{id:record.id}});/* Generic response avoids account disclosure. */}
 }
 res.json({ok:true,message:'Jika akun tersedia, instruksi reset dikirim.'});
}
export async function resetPassword(req:Request,res:Response){
 requireOrigin(req);const input=z.object({token:z.string().regex(/^[a-f0-9]{64}$/),password:z.string().min(12).max(128)}).strict().parse(req.body);
 const passwordHash=await argon2.hash(input.password,{type:argon2.argon2id});
 await atomic(async tx=>{const record=await tx.passwordReset.findUnique({where:{tokenHash:hash(input.token)}});
  if(!record||record.usedAt||record.expiresAt<=new Date())throw new DomainError(400,'Link reset kedaluwarsa/tidak valid');
  const changed=await tx.passwordReset.updateMany({where:{id:record.id,usedAt:null},data:{usedAt:new Date()}});if(changed.count!==1)throw new DomainError(409,'Link sudah digunakan');
  await tx.user.update({where:{id:record.userId},data:{passwordHash}});await tx.session.deleteMany({where:{userId:record.userId}});await tx.passwordReset.updateMany({where:{userId:record.userId,usedAt:null},data:{usedAt:new Date()}});
 });res.json({ok:true});
}
