# Ubuntu 22.04 / 24.04 — Termius / SSH

Panduan ini untuk aplikasi mandiri, bukan instalasi di admin Shopify.
Termius adalah client SSH. Host/port/user/key berasal dari provider VPS NAT Anda;
jangan kirim SSH key, password DB atau bot token lewat chat.
Review source dan uji di mesin development sebelum menggunakan transaksi nyata.

## 1. SSH dan OS
Masuk memakai host dan forwarded SSH port dari provider. Jangan mengubah SSH port/firewall
sebelum ada sesi SSH kedua yang teruji. Contoh terminal lokal:

    ssh -p PORT USER@HOST
    lsb_release -a
    node --version
    npm --version
    sudo apt update
    sudo apt install -y postgresql postgresql-contrib nginx build-essential unzip openssl

Node harus >=20; pilih LTS yang masih didukung. Gunakan installer/repository resmi Node untuk OS
Anda dan verifikasi signature, jangan menyalin curl|bash dari sumber tidak dikenal.
Jika Node belum tersedia, install dahulu sebelum npm commands.
Jalankan aplikasi sebagai user deployment non-root; gunakan sudo hanya untuk konfigurasi sistem.

## 2. DB lokal

    sudo systemctl enable --now postgresql
    sudo -u postgres psql

Dalam psql:

    CREATE ROLE rexmarket LOGIN;
    \password rexmarket
    CREATE DATABASE rexmarket OWNER rexmarket;
    CREATE DATABASE rexmarket_test OWNER rexmarket;
    \q

Password diset melalui prompt, bukan history command. Review postgresql.conf: listen_addresses='localhost'.
Review pg_hba.conf: autentikasi scram-sha-256 untuk user aplikasi, tidak ada trust remote.
Jangan expose/forward 5432. Reload hanya setelah perubahan valid:

    sudo systemctl reload postgresql
    ss -lnt | grep 5432

Jangan menambahkan CREATEDB ke user produksi. Restore fresh DB dapat dibuat oleh postgres operator.
DB test boleh di mesin development, tidak wajib berada di VPS produksi.

## 3. Source dan env
Extract ZIP ke /opt/rexmarket dengan user yang memiliki direktori tersebut.
ZIP berisi folder rexmarket-rc-20261012-c3; pindahkan isinya, termasuk .env.example, bukan .env nyata.
Jangan menimpa instalasi existing tanpa backup.

    cd /opt/rexmarket
    cp .env.example .env
    chmod 600 .env
    openssl rand -hex 32

Edit .env memakai editor lokal/SSH. Isi DB URL (URL-encode password khusus), WEB_ORIGIN,
STORAGE_ROOT=/var/lib/rexmarket/media, DELIVERY_ENCRYPTION_KEY, bot token, root Telegram ID.
Root Telegram ID adalah user ID numeric, bukan username atau group ID.
SMTP opsional; tanpa SMTP endpoint reset return 503. Gunakan TLS dan akun khusus.
Buat storage dengan owner user aplikasi, permission 0700. Jangan meletakkannya di web/dist.
Kunci delivery harus sama di API dan bot serta dijaga saat deploy ulang.

## 4. Dependencies, migrasi dan bootstrap
Pada development awal (lockfile belum tersedia di ZIP):

    npm install
    npm --prefix web install
    npm run db:generate
    npx prisma validate
    npm run check
    npm run build
    npm run db:deploy
    npm run db:seed
    bash scripts/bootstrap-admin.sh

Uji database terpisah dengan DATABASE_URL ke rexmarket_test dan NODE_ENV=test,
WEB_ORIGIN=http://localhost:5173, DELIVERY_ENCRYPTION_KEY yang valid.
Set lewat file env privat atau shell tanpa menyimpan secret ke history.
Terapkan migrasi ke DB test, lalu npm test. Setelah audit/review, commit kedua package-lock.json.
Deployment berikutnya memakai npm ci lewat scripts/deploy.sh; jangan generate lock baru di produksi.
Seed tidak membuat user. Bootstrap prompt password tersembunyi; file sementara mode 0600 dihapus oleh trap.
SUPER_ADMIN_TELEGRAM_ID harus terisi sebelum bootstrap, agar bot dapat memeriksa root di DB saat startup.

Jika bootstrap telanjur tanpa telegramId, bot tidak akan startup. Perbaiki lewat psql lokal sebagai operator:

    UPDATE "User" SET "telegramId"='ID_NUMERIC_ANDA' WHERE "email"='EMAIL_ROOT_ANDA' AND "role"='SUPER_ADMIN';

Contoh ini placeholder, bukan perintah dengan identitas nyata. Pastikan tepat satu row berubah;
jangan mengubah password/role sembarangan. Jangan mengakses PostgreSQL lewat internet.

## 5. Domain HTTPS / NAT
Frontend dan /api harus satu origin. WEB_ORIGIN hanya origin tanpa path.
Pilihan A: provider NAT forward port 80/443 ke Nginx; pasang sertifikat valid untuk hostname,
review deploy/nginx.conf.example, sesuaikan DOMAIN, cert path dan web root.
Jika provider port forwarding memakai external port khusus, masukkan port dalam WEB_ORIGIN;
sertifikat tetap harus sesuai hostname. DNS-01 dapat diperlukan bila HTTP challenge tidak reachable.

Pilihan B: tunnel HTTPS dari provider terpercaya, outbound dari VPS, route public hostname ke
http://127.0.0.1:8080. Gunakan deploy/nginx-tunnel.conf.example. Jangan buka port 8080 ke publik.
Install/persist tunnel menurut dokumentasi provider, lindungi token tunnel di file privat.
Jangan aktifkan access-login gate di atas frontend publik kecuali memang toko privat.

    sudo nginx -t
    sudo systemctl enable --now nginx
    sudo systemctl reload nginx

Testing privat tanpa public exposure:

    ssh -p PORT -L 3000:127.0.0.1:3000 USER@HOST

Untuk frontend development di VPS, tunnel 5173 juga dan atur WEB_ORIGIN sesuai browser.
HTTPS wajib produksi karena cookie Secure. Bot tidak memerlukan inbound port karena long polling.

## 6. PM2

    npm install -g pm2
    bash scripts/deploy.sh
    pm2 status
    pm2 logs rexmarket-api
    pm2 logs rexmarket-bot
    pm2 startup

Jalankan persis sudo command yang PM2 tampilkan untuk user deployment dan PATH Node Anda.
Lalu pm2 save. Reboot terencana dan cek status. Satu instance bot; jangan jalankan dua bot polling
dengan token sama. User root harus private-chat /start ke bot sebelum notifikasi dapat dikirim.
Rotate log (pm2-logrotate bila dipasang), lindungi log dan jangan log env/token/file proof.

## 7. Smoke test
Login root, upload QRIS, isi syarat/nama/kategori, review seed harga, tes Customer beli paket,
reseller tambah produk dan kode digital, admin approve produk, customer order dan upload proof,
bot approve/reject alasan, customer upload ulang, delivery, ledger, expiry, dua approval bersamaan.
QRIS harus diverifikasi operator melalui mutasi pembayaran nyata, bukan screenshot saja.
Jangan isi data mock untuk mengklaim deploy berhasil. Tidak ada akun/password publik bawaan.

## 8. Backup/restore
Gunakan .pgpass mode 0600, PGUSER/PGDATABASE/PGHOST untuk pg_dump. Jangan password pada CLI.
Backups mengandung data pribadi. Set BACKUP_DIR privat di luar web root dan STORAGE_ROOT absolut.

    PGHOST=127.0.0.1 PGUSER=rexmarket PGDATABASE=rexmarket \
      BACKUP_DIR=/opt/rexmarket-backups STORAGE_ROOT=/var/lib/rexmarket/media \
      bash scripts/backup.sh

Skrip menghentikan dua writer sementara, dump DB, arsip storage, checksum, menyalakan ulang via trap.
Jangan gunakan skrip jika ada writer lain. Enkripsi backup dan copy offsite; backup encryption key
secara terpisah. Retention/penjadwalan disesuaikan operator; jangan hapus backup yang belum diverifikasi.

Restore di environment terpisah:

    RESTORE_DATABASE=rexmarket_restore PGUSER=USER_BERIZIN_CREATE_DB \
      DUMP_FILE=/private/backup.dump bash scripts/restore.sh

Script createdb gagal jika DB sudah ada, tidak memakai --clean/drop. Untuk user tanpa CREATEDB,
buat DB baru via postgres operator dan jalankan pg_restore langsung dengan owner DB yang sesuai.
Extract backup storage ke DIREKTORI BARU privat; pakai encryption key yang sama, isi .env baru,
uji delivery/decrypt, audit/order/ledger/media. Jangan restore ke database aktif.
Cutover setelah semua writer berhenti dan rollback plan tersedia. pm2 save sesudah konfigurasi benar.

## Tambahan RC1: staging dan gate deployment
scripts/deploy.sh sekarang menjalankan NODE_ENV=production npm run readiness sebelum PM2 reload.
Konfigurasi production harus WEB_ORIGIN HTTPS. Jika readiness gagal, skrip tidak me-reload proses,
tetapi migration/seed sebelumnya mungkin sudah berjalan: backup sebelum menjalankan skrip tetap wajib.
Fresh install: siapkan staging privat, start API saja untuk konfigurasi awal,
misalnya pm2 start deploy/ecosystem.config.cjs --only rexmarket-api, dan jangan arahkan traffic publik.
Isi QRIS/terms/name/root lewat staging yang terautentikasi, jalankan readiness, lalu deployment penuh.
Gunakan staging HTTPS atau development SSH tunnel dengan NODE_ENV=development;
jangan menonaktifkan Secure cookies untuk deployment publik.
Untuk upgrade, pertahankan .env, media dan encryption key, serta lockfile hasil instalasi/review Anda.
Baca RELEASE-CANDIDATE.md. Readiness tidak menggantikan acceptance browser/bot/restore.
