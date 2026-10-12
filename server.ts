import {randomUUID} from 'node:crypto';
import {app} from './app.js';import {env} from './config.js';import {db} from './db.js';import {cleanExpiredAuth} from './operations.js';import pino from 'pino';
const logger=pino();
const server=app.listen(env.PORT,'127.0.0.1',()=>logger.info({port:env.PORT},'API aktif'));
let cleaning=false;
const timer=setInterval(()=>{if(cleaning)return;cleaning=true;void cleanExpiredAuth().catch(()=>logger.warn({eventId:randomUUID()},'Auth cleanup gagal')).finally(()=>{cleaning=false;});},600000);
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(stopping)return;stopping=true;clearInterval(timer);server.close(()=>{void db.$disconnect().finally(()=>process.exit(0));});setTimeout(()=>process.exit(1),10000).unref();});
