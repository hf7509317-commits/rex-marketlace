# REXMARKET RC1 — bukan sertifikasi production-ready

Merchant melaporkan versi sebelumnya tidak error. Laporan tersebut dicatat, tetapi environment,
command, hasil tes dan deployment belum diobservasi pembuat paket. Source RC1 melanjutkan versi itu,
bukan mengganti sistem dengan mockup. Tidak ada pembayaran atau notifikasi sungguhan yang dikirim saat pembuatan.

## Perubahan
Form paket, promo, role/status, notifikasi dan setting web menggunakan field biasa, bukan textarea JSON.
Notifikasi manual meminta konfirmasi sebelum dikirim melalui web.
API dan bot menggunakan shared admin service untuk paket, promo, notifikasi dan review produk.
Service admin memeriksa role/active di dalam transaksi, bukan hanya sebelum transaksi dimulai.
Create/edit/review produk, tambah stok, submit proof, edit paket/promo/notifikasi mendapat audit terkait.
Nilai before/after paket/promo/review disimpan; payload kode digital dan isi notifikasi tidak disalin ke audit.
HTTP request memiliki X-Request-ID dan log terstruktur tanpa body, password, cookie, token atau query string.
Pembersihan session/token autentikasi expired berjalan berkala; ledger, bukti dan audit tidak dihapus otomatis.
Readiness CLI memeriksa DB/migration, write storage privat, kesesuaian stock/unit,
QRIS, nama/syarat, root Telegram dan format token. CLI tidak mengirim Telegram RPC.
GET /admin/readiness memeriksa infrastruktur dan dibatasi Super Admin.
GitHub Actions + scripts/verify.sh disediakan untuk build/migration/tes/audit pada DB test terpisah.
Source tes baru memeriksa service admin, audit, role disabled, expired promo dan privacy log.

## Upgrade dari ZIP sebelumnya
Backup source, DB, storage dan encryption key. Pertahankan .env nyata dan key lama;
jangan copy .env.example di atas .env existing. Tidak ada perubahan schema pada RC1 ini.
Perubahan database awal tetap berasal dari migrasi initial yang sama.
Salin source baru secara terkendali. Pertahankan package-lock.json dan web/package-lock.json hasil instalasi
Anda yang sudah direview bila manifest dependency tidak berubah (RC1 hanya menambah script readiness).
Untuk instalasi baru, npm install di root dan web lalu audit/review lockfiles sebelum deploy npm ci.
Tunjuk DATABASE_URL ke rexmarket_test di environment validasi lalu jalankan scripts/verify.sh.
Gunakan konfigurasi production terpisah untuk npm run readiness; jangan menjalankan tes di DB production.
Isi syarat/QRIS/nama dan root Telegram sebelum readiness PASS. Fresh setup memerlukan staging API terlebih dahulu.
Readiness PASS hanyalah pemeriksaan konfigurasi, bukan hasil tes keamanan, browser, SMTP atau bot.

## Acceptance tetap diperlukan
Browser dua reseller dengan order lintas kepemilikan, callback stale dan approval konkuren,
Telegram polling nyata, SMTP reset, QRIS manual nyata oleh operator, NAT/TLS, restart PM2 dan backup restore.
Buka layanan publik hanya sesudah hasil tes otomatis dan acceptance di environment Anda lulus.
Stock reservation, refund/payout otomatis, malware scanning dan external integrations tidak ditambahkan.
Stok habis ketika approval masih perlu penyelesaian manual; kebijakan operasional harus jelas.

## CI
Workflow tidak memakai bot/DB production credentials. PostgreSQL CI disposable menggunakan trust
pada service yang portnya bind ke 127.0.0.1 runner saja. Ini bukan contoh konfigurasi PostgreSQL VPS!
CI sengaja berhenti jika dua lockfile belum disertakan, alih-alih mengklaim build reproducible tanpa lock.
Tidak ada workflow, build, test atau deployment yang dijalankan dari lingkungan pembuatan ZIP ini.
