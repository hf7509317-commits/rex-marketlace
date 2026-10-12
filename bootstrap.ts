import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import argon2 from 'argon2';
import { atomic, db } from './db.js';
// Password is read from an ephemeral protected file, never a CLI argument.
import { readFile, stat } from 'node:fs/promises';
async function main() {
  const passwordFile = process.env.BOOTSTRAP_PASSWORD_FILE;
  if (!passwordFile) throw new Error('Set BOOTSTRAP_PASSWORD_FILE ke file lokal mode 0600');
  const info = await stat(passwordFile);
  if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.uid !== process.getuid?.()) throw new Error('File harus milik user proses, mode 0600');
  const password = (await readFile(passwordFile, 'utf8')).replace(/\r?\n$/, '');
  if (password.length < 16 || password.length > 128) throw new Error('Password harus 16–128 karakter');
  const prompt = createInterface({ input: stdin, output: stdout });
  const email = (await prompt.question('Email Super Admin: ')).trim().toLowerCase();
  prompt.close();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email tidak valid');
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await atomic(async tx => {
    if (await tx.bootstrapMarker.findUnique({ where: { id: 'super-admin-v1' } })) throw new Error('Bootstrap sudah dijalankan');
    if (await tx.user.count({ where: { role: 'SUPER_ADMIN' } })) throw new Error('Super Admin sudah ada');
    await tx.bootstrapMarker.create({ data: { id: 'super-admin-v1' } });
    const telegramId = process.env.SUPER_ADMIN_TELEGRAM_ID;
    if (telegramId && !/^[1-9]\d{0,15}$/.test(telegramId)) throw new Error('SUPER_ADMIN_TELEGRAM_ID tidak valid');
    await tx.user.create({ data: { email, passwordHash, role: 'SUPER_ADMIN', telegramId: telegramId || null } });
  });
  console.log('Super Admin dibuat. Hapus file password sementara.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
