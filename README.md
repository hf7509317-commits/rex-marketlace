# REXMARKET

Source aplikasi marketplace digital mandiri: React/Vite/Tailwind, API Express TypeScript,
bot Telegraf long polling, Prisma/PostgreSQL, shared service layer.

**Status: source implementasi, belum diverifikasi build/tes/deployment. Bukan sertifikasi production-ready.**
Paket ini tidak memiliki kredensial nyata, lockfile hasil instalasi, atau dependency vendored.
Jalankan validasi di mesin development sebelum membuka layanan publik. Jangan menyimpan uang sungguhan
dalam transaksi percobaan. Operator bertanggung jawab atas produk yang sah dan izin penggunaan QRIS.

## File dan proses
- src/app.ts, server.ts: API; bind localhost.
- src/bot.ts: bot + worker outbox; tepat satu instance polling.
- src/services.ts, orders.ts, payments.ts: aturan bisnis bersama.
- src/auth.ts: session, login throttle DB, reset SMTP opsional.
- src/media.ts: storage privat, validasi isi/MIME/ekstensi/ukuran.
- web/: frontend berbasis role.
- prisma/: schema, initial SQL migration dengan CHECK constraints, seed idempoten.
- scripts/, deploy/, docs/, tests/: operasi, deployment, API dan tes.

## Cakupan fungsional
Guest katalog/paket/syarat; Customer registrasi/login/profil/order/QRIS/bukti/resubmission/delivery/notifikasi;
Reseller paket aktif, toko, CRUD edit/create produk, stok digital terenkripsi, ledger dan penjualan;
Admin persetujuan produk/pembayaran, statistik, pengguna, ledger dan audit;
Super Admin role/status user, konfigurasi website, media, paket dan promo.
Dashboard SSE diperbarui setiap 10 detik, bukan stream perubahan DB per transaksi.
Semua list HTTP maksimal 50 per halaman menggunakan offset; list Telegram maksimal 10.

Approval satu transaksi: status, stok bersyarat, alokasi payload digital, komisi unik per item,
paket, audit dan notifikasi. PostgreSQL SERIALIZABLE + retry serialization failure/deadlock.
Outbox Telegram bersifat at-least-once: notifikasi bisa duplikat setelah crash, transaksi tidak.
Unapprove wajib alasan; bukti versi lama ditolak. File proof asli disimpan dan dikirim sebagai document.
Gambar website di-decode/re-encode. URL media arbitrer tidak didukung: mencegah jalur SSRF.

## Mulai development
Node 20+ (pilih release yang masih didukung), PostgreSQL lokal, npm dan build tools untuk native dependency.

    cp .env.example .env
    chmod 600 .env
    # Isi DATABASE_URL, WEB_ORIGIN, STORAGE_ROOT dan DELIVERY_ENCRYPTION_KEY.
    # Buat kunci: openssl rand -hex 32
    npm install
    npm --prefix web install
    npm run db:generate
    npm run db:deploy
    npm run db:seed
    bash scripts/bootstrap-admin.sh
    npm run dev
    npm --prefix web run dev

Gunakan dua terminal untuk API dan frontend. WEB_ORIGIN default http://localhost:5173;
akses browser persis origin tersebut. Port API tidak menerima permintaan Origin yang berbeda.
Untuk bot: isi TELEGRAM_BOT_TOKEN dan SUPER_ADMIN_TELEGRAM_ID SEBELUM bootstrap,
chat /start dari akun Telegram Super Admin, lalu npm run bot dalam terminal ketiga.
Jika root sudah dibuat tanpa Telegram ID, login website, Profil > Hubungkan Telegram,
jalankan UPDATE terkontrol lokal oleh operator atau bootstrap ID sebelum bot startup:
lihat docs/DEPLOYMENT.md. Jangan membuat akun root kedua lewat seed.

## Seed pilihan awal (wajib direview)
Basic Rp50.000 / 30 hari / 10 produk / fee platform 15%.
Pro Rp150.000 / 90 hari / 50 produk / fee 10%.
Premium Rp500.000 / permanen / 200 produk / fee 5%.
Nilai ini adalah keputusan awal implementasi, bukan rekomendasi harga bisnis yang sudah divalidasi.
Syarat layanan kosong, QRIS/logo/banner null. Seed ulang tidak menimpa konfigurasi existing.
Paket dibayar menggunakan alur QRIS yang sama. Snapshot batas/fee disimpan saat order dibuat.
Paket baru mengganti tier; hari tersisa dibawa ke masa aktif baru. Paket permanen tetap permanen.
Komisi reseller = harga efektif × kuantitas minus fee platform; ledger bukan payout bank.
Promo memotong harga unit produk; fee dihitung atas harga setelah promo.

## Uji sebelum deployment
Buat database TERPISAH bernama rexmarket_test, terapkan initial migration di sana.
Gunakan env privat yang menunjuk DB tes; semua tes menolak DB selain rexmarket_test.

    npm run check
    npm run build
    npm test
    npm audit
    npm --prefix web audit

Commit lockfile root dan web hasil install setelah review; deployment memakai npm ci.
Jangan menjalankan tes melawan DB produksi. Tes integrasi membutuhkan PostgreSQL aktif.
Nama DB development/production tidak boleh rexmarket_test.
Source tes mencakup approval ganda, stok habis rollback, role, alasan penolakan, stale proof,
HTTP session/CSRF/ownership, dan integritas ciphertext. Belum dieksekusi dalam paket ini.

## VPS dan operasi
Ikuti docs/DEPLOYMENT.md untuk Ubuntu/Termius, PostgreSQL, Nginx/NAT, PM2 dan restore.
Ikuti docs/API.md untuk endpoint dan docs/SECURITY.md untuk gate keamanan.

## Batasan eksplisit
Tidak ada escrow/payout/withdrawal/refund otomatis atau integrasi gateway QRIS.
Tidak ada reservasi stok sebelum pembayaran: stok habis saat approval perlu penyelesaian manual
(refund atau penyediaan unit baru). Customer diberi tahu di dokumentasi; operator harus menambahkan
kebijakan refund dan reservasi bila model bisnis membutuhkannya.
Tidak ada scanner malware eksternal; PDF proof diunduh sebagai attachment bersandbox dan tidak dirender.
Gunakan viewer aman/antimalware operator. Original proof bukan bukti keaslian pembayaran; cek mutasi QRIS nyata.
Admin tidak dapat mengubah role, paket, settings atau promo tanpa role Super Admin.
Source mencakup alur inti yang diminta, bukan integrasi eksternal yang sudah diuji.

## RC1 — pembaruan untuk persiapan penggunaan nyata
Baca docs/RELEASE-CANDIDATE.md untuk perubahan dan upgrade dari ZIP sebelumnya.
Form admin/settings kini field biasa; service perubahan admin berbagi kode dengan bot dan audit atomik.
Tambahan: npm run readiness, scripts/verify.sh, CI GitHub Actions, request ID/log, cleanup expired auth.
Status pengujian masih NOT RUN dalam lingkungan pembuat. Readiness PASS bukan production certification.
Paket ini tidak mengisi QRIS/operator terms atau mengganti .env/kunci deployment existing.
