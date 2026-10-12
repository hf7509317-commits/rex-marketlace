import {describe,it,expect,afterAll} from 'vitest';import request from 'supertest';import {randomUUID} from 'node:crypto';
import {app} from '../src/app.js';import {db} from '../src/db.js';import {origin} from '../src/config.js';
if(!process.env.DATABASE_URL?.includes('/rexmarket_test?'))throw new Error('Gunakan rexmarket_test saja');
const email=`http-${randomUUID()}@example.test`;const password=`${randomUUID()}-PASSWORD`;
describe('HTTP authentication and ownership',()=>{
 it('rejects writes from unknown origin',async()=>{const res=await request(app).post('/auth/register').set('Origin','https://untrusted.example').send({email,password});expect(res.status).toBe(403);});
 it('ignores no role injection: strict registration schema rejects role',async()=>{const res=await request(app).post('/auth/register').set('Origin',origin).send({email,password,role:'SUPER_ADMIN'});expect(res.status).toBe(400);});
 it('registers, logs in, requires CSRF and prevents non-admin access',async()=>{
  const agent=request.agent(app);expect((await agent.post('/auth/register').set('Origin',origin).send({email,password})).status).toBe(201);
  const login=await agent.post('/auth/login').set('Origin',origin).send({email,password});expect(login.status).toBe(200);expect(login.body.user.role).toBe('CUSTOMER');
  expect((await agent.get('/auth/me')).status).toBe(200);
  expect((await agent.patch('/profile').set('Origin',origin).send({displayName:'Test',storeName:''})).status).toBe(403);
  expect((await agent.get('/admin/users')).status).toBe(403);
  expect((await agent.get('/orders/cnotmine')).status).toBe(404);
  const csrf=login.body.csrfToken;
  expect((await agent.patch('/profile').set('Origin',origin).set('X-CSRF-Token',csrf).send({displayName:'Test',storeName:''})).status).toBe(200);
  expect((await agent.post('/auth/logout').set('Origin',origin).set('X-CSRF-Token',csrf).send({})).status).toBe(200);
  expect((await agent.get('/auth/me')).status).toBe(401);
 });
});
afterAll(async()=>{const u=await db.user.findUnique({where:{email}});if(u)await db.user.delete({where:{id:u.id}});await db.$disconnect();});
