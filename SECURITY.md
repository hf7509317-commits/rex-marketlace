# Security dan acceptance checklist
Status: ditulis, belum diuji/diaudit. Tidak ada jaminan keamanan hanya karena kontrol ada dalam source.

Session hashed SHA-256 di DB; password Argon2id; bootstrap tanpa default dan marker unique.
CSRF menggunakan random token session plus exact Origin untuk write. Login/register/reset juga exact Origin.
API localhost, loopback proxy trusted; jangan ubah trust proxy sembarangan.
Login IP limit in-memory + persistent per-account budget 10 attempts / 15 menit.
Generic errors, CSP/Helmet, cookie Secure produksi, CORS exact origin, private storage.
Semua callback dijawab sebelum operasi; session reject/media terikat user dan private chat dengan expiry 5 menit.
Bot bootstrap identity numeric; semua admin action memeriksa DB role/active dan root id.
Delivery encrypted AES-256-GCM; key 32 byte disediakan operator, bukan hardcoded.
Backup key secara terpisah; hilangnya key membuat payload digital tak dapat didekripsi.

Gate:
- Install locked dependencies yang diaudit; tidak ada credential dalam git/ZIP/log.
- Jalankan Prisma validate/generate, tsc, web build, Vitest dan Supertest.
- Uji HTTP lintas dua reseller, proof IDOR, admin disabled, session revoked.
- Uji dua admin approve bersamaan dan satu stok dibeli dua order.
- Uji alasan reject, upload ulang, callback lama dan expired bot conversations.
- Uji corrupt file, extension spoofing, SVG, HTML, multipart limit, PDF viewer aman.
- Uji SMTP failure/expiry/token reuse dan reset logout semua session.
- Uji backup konsisten DB/media, restore fresh DB, key restoration dan NAT HTTPS.
- Review QRIS, syarat layanan, penanganan refund/manual stock-out dan hak produk digital.
- Monitor disk/media growth, outbox lastError, PM2 restarts, backup age dan PostgreSQL.

Pembatasan:
General HTTP limiter in-memory reset saat restart; hanya satu instance API di PM2.
Tunnel reverse proxy melihat IP loopback sehingga limit per-IP dapat dibagi semua pengguna;
login account throttle tetap bekerja. Produksi ramai memerlukan shared limiter + trust chain teruji.
PDF tidak disanitasi atau discan malware, hanya signature/size dan attachment. Jangan buka di viewer rentan.
Media gagal submit setelah file disimpan bisa menyisakan file orphan; cleanup operator diperlukan.
Tidak ada endpoint delete media agar bukti audit tidak terhapus sembarangan.
Kirim notifikasi bukan broadcast: hanya user ID tertentu; perlukan konfirmasi UI sebelum melayani publik.
Audit per review transaksi/settings/user/bot perubahan; audit bukan log immutable/WORM.
Tidak ada MFA atau SOC/security certification. Tambahkan sesuai kebutuhan sebelum skala besar.
