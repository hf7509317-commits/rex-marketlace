import 'dotenv/config';import {Prisma,PrismaClient} from '@prisma/client';const db=new PrismaClient();
async function main(){await db.$transaction(async tx=>{
 // Business defaults only, never accounts or passwords. Existing settings untouched.
 const settings:Record<string,Prisma.InputJsonValue|typeof Prisma.JsonNull>={name:'REXMARKET',terms:'',maintenance:false,categories:['Digital','Lisensi','Voucher'],logo:Prisma.JsonNull,banner:Prisma.JsonNull,qris:Prisma.JsonNull};
 for(const [key,value]of Object.entries(settings))await tx.setting.upsert({where:{key},create:{key,value},update:{}});
 for(const plan of [{name:'Basic',price:50000,durationDays:30,productLimit:10,platformFeeBps:1500},{name:'Pro',price:150000,durationDays:90,productLimit:50,platformFeeBps:1000},{name:'Premium',price:500000,durationDays:null,productLimit:200,platformFeeBps:500}])await tx.plan.upsert({where:{name:plan.name},create:plan,update:{}});
 });console.log('Seed konfigurasi selesai; data existing tidak diubah. Review harga dan syarat sebelum launch.');}
main().catch(()=>{console.error('Seed gagal');process.exitCode=1;}).finally(()=>db.$disconnect());
