import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db, DomainError } from './db.js';
import { storageRoot } from './config.js';
const allowed: Record<string,string> = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'application/pdf':'pdf' };
export async function saveMedia(ownerId: string, input: Buffer, name: string, mime: string, isPublic = false) {
  if (!input.length || input.length > 5 * 1024 * 1024) throw new DomainError(400, 'Batas file 5 MB');
  const type = await fileTypeFromBuffer(input);
  const ext = name.split('.').pop()?.toLowerCase();
  if (!type || !allowed[type.mime] || type.mime !== mime || !(ext === allowed[type.mime] || (type.mime === 'image/jpeg' && ext === 'jpeg'))) throw new DomainError(400, 'Isi, MIME dan ekstensi file tidak sesuai');
  if (isPublic && type.mime === 'application/pdf') throw new DomainError(400, 'Media website harus gambar');
  let bytes = input; let outMime = type.mime; let outExt = allowed[type.mime];
  if (type.mime.startsWith('image/')) {
    // Decode and re-encode: no SVG, metadata or arbitrary embedded payload retained.
    const decoded = await sharp(input, { limitInputPixels: 20_000_000, animated: false }).rotate().jpeg({ quality: 90 }).toBuffer();
    if (isPublic) { bytes = decoded; outMime = 'image/jpeg'; outExt = 'jpg'; }
    // Private proof retains original bytes; send as document/attachment, never executable HTML.
  } else {
    // PDF is kept original and served ONLY as attachment under sandbox CSP.
    if (!input.subarray(Math.max(0,input.length - 2048)).includes(Buffer.from('%%EOF'))) throw new DomainError(400, 'PDF tidak lengkap');
  }
  const key = `${randomUUID()}.${outExt}`;
  await mkdir(storageRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(storageRoot, key), bytes, { flag: 'wx', mode: 0o600 });
  try { return await db.media.create({ data: { ownerId, key, mime: outMime, size: bytes.length, public: isPublic } }); }
  catch (error) { await unlink(join(storageRoot,key)).catch(() => {}); throw error; }
}
export async function mediaBytes(key: string) {
  if (!/^[a-f0-9-]{36}\.(jpg|png|webp|pdf)$/.test(key)) throw new DomainError(400, 'Storage key tidak valid');
  return readFile(join(storageRoot,key));
}
