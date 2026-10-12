# Validation RC1

Laporan merchant: versi sebelumnya tidak error. Detail lingkungan dan hasil command tidak tersedia.
Verifikasi independen pembuat paket: build, install, PostgreSQL, migration, Vitest/Supertest,
Telegram/SMTP connection, HTTPS/NAT, backup restore dan deployment BELUM DIJALANKAN.
Paket source RC1 menyediakan checks, bukan hasil eksekusi checks.
Archive integrity check (unzip -t) hanya menguji ZIP, bukan aplikasi.

Jalankan verify.sh pada DB rexmarket_test terpisah dengan env/key privat dan kedua lockfile.
Jalankan readiness dengan konfigurasi target sesudah QRIS/terms/root diset.
Lanjutkan acceptance browser/bot/backup seperti RELEASE-CANDIDATE dan SECURITY.
Tidak ada klaim production-ready, audit keamanan lulus, atau deployment sudah aktif.
