import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../src/db.js';
import { reviewPayment } from '../src/payments.js';
import { encrypt } from '../src/services.js';
// Run ONLY against a separate empty test database. Never use production.
if (!process.env.DATABASE_URL?.includes('/rexmarket_test?')) throw new Error('DATABASE_URL harus memakai database rexmarket_test');
const actors: string[] = [], products: string[] = [], orders: string[] = [];
async function fixture() {
  const suffix = randomUUID();
  const admin = await db.user.create({ data: { email: `admin-${suffix}@example.test`, passwordHash: 'not-a-login-hash', role: 'ADMIN' } }); actors.push(admin.id);
  const buyer = await db.user.create({ data: { email: `buyer-${suffix}@example.test`, passwordHash: 'not-a-login-hash' } }); actors.push(buyer.id);
  const seller = await db.user.create({ data: { email: `seller-${suffix}@example.test`, passwordHash: 'not-a-login-hash', role: 'RESELLER' } }); actors.push(seller.id);
  const product = await db.product.create({ data: { sellerId: seller.id, title: 'Test', price: 10000, stock: 1, approved: true, platformFeeBps: 1000 } }); products.push(product.id);
  await db.digitalUnit.create({ data: { productId: product.id, ciphertext: encrypt('TEST-DIGITAL-CODE') } });
  const order = await db.order.create({ data: { buyerId: buyer.id, requestKey: suffix, status: 'PENDING_REVIEW', total: 10000, items: { create: { productId: product.id, sellerIdSnapshot: seller.id, titleSnapshot: 'Test', priceSnapshot: 10000, quantity: 1, platformFeeBpsSnapshot: 1000 } }, proofs: { create: { version: 1, storageKey: suffix } } }, include: { proofs: true } }); orders.push(order.id);
  return { admin, buyer, seller, product, order, proof: order.proofs[0] };
}
describe('Payment integration against PostgreSQL', () => {
  it('two concurrent approvals decrement stock and credit once', async () => {
    const f = await fixture();
    await Promise.all([reviewPayment(f.admin.id, f.proof.id, true), reviewPayment(f.admin.id, f.proof.id, true)]);
    expect((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).stock).toBe(0);
    const credits = await db.commission.findMany({ where: { sellerId: f.seller.id } });
    expect(credits).toHaveLength(1); expect(credits[0].net).toBe(9000);
    expect(await db.outbox.count({ where: { key: `payment-review:${f.proof.id}` } })).toBe(1);
  });
  it('insufficient stock rolls back status, commission, and outbox', async () => {
    const f = await fixture();
    await db.product.update({ where: { id: f.product.id }, data: { stock: 0 } });
    await expect(reviewPayment(f.admin.id, f.proof.id, true)).rejects.toThrow('Stok');
    expect((await db.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe('PENDING_REVIEW');
    expect(await db.commission.count({ where: { sellerId: f.seller.id } })).toBe(0);
  });
  it('customer cannot approve and rejection requires a reason', async () => {
    const f = await fixture();
    await expect(reviewPayment(f.buyer.id, f.proof.id, true)).rejects.toThrow('Tidak berwenang');
    await expect(reviewPayment(f.admin.id, f.proof.id, false)).rejects.toThrow('Alasan');
    await reviewPayment(f.admin.id, f.proof.id, false, 'Nominal tidak sesuai');
    expect((await db.paymentProof.findUniqueOrThrow({ where: { id: f.proof.id } })).rejectionReason).toBe('Nominal tidak sesuai');
  });
  it('stale proof cannot approve a newer submission', async () => {
    const f = await fixture();
    await reviewPayment(f.admin.id, f.proof.id, false, 'Bukti tidak jelas');
    await db.$transaction([
      db.paymentProof.create({ data: { orderId: f.order.id, version: 2, storageKey: randomUUID() } }),
      db.order.update({ where: { id: f.order.id }, data: { status: 'PENDING_REVIEW' } })
    ]);
    await expect(reviewPayment(f.admin.id, f.proof.id, true)).rejects.toThrow('kedaluwarsa');
  });
});
afterAll(async () => {
  const proofs = await db.paymentProof.findMany({ where: { orderId: { in: orders } }, select: { id: true } });
  await db.outbox.deleteMany({ where: { key: { in: proofs.map(p => `payment-review:${p.id}`) } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: actors } } });
  await db.commission.deleteMany({ where: { sellerId: { in: actors } } });
  await db.paymentProof.deleteMany({ where: { orderId: { in: orders } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: orders } } });
  await db.order.deleteMany({ where: { id: { in: orders } } });
  await db.digitalUnit.deleteMany({ where: { productId: { in: products } } });
  await db.notification.deleteMany({ where: { userId: { in: actors } } });
  await db.product.deleteMany({ where: { id: { in: products } } });
  await db.user.deleteMany({ where: { id: { in: actors } } });
  await db.$disconnect();
});
