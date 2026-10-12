# HTTP API
Base internal http://127.0.0.1:3000; public /api via same-origin Nginx.
Semua response JSON kecuali media dan SSE. Request write menggunakan Origin persis WEB_ORIGIN.
Login mengatur cookie HttpOnly, SameSite=Strict, Secure di produksi. Setelah login/me,
client harus mengirim X-CSRF-Token pada semua write authenticated. Browser credentials: include.
Tidak ada bearer-token web; jangan simpan session di localStorage.
List offset=N (default 0), maksimum 50 record, kecuali settings dan plan. Halaman kosong tidak berarti
seluruh sistem kosong; gunakan offset untuk lanjut. Pagination setelah filter expired reseller bisa kosong.

## Public / auth
GET /health; GET /public/settings; GET /public/plans; GET /public/products?offset=0.
POST /auth/register {email,password} password 12–128; role selalu CUSTOMER.
POST /auth/login {email,password}; response {user,csrfToken}; cookie session 8 jam.
GET /auth/me; POST /auth/logout {}.
POST /auth/reset/request {email}; generic response, 503 jika SMTP tidak dikonfigurasi.
POST /auth/reset/confirm {token,password}; token single-use 20 menit, semua session dibatalkan.
PATCH /profile {displayName,storeName}; POST /profile/telegram-link {} -> perintah /link KODE 10 menit.

## Customer
POST /orders {requestKey:UUID,items:[{productId,quantity}],promoCode?}
ATAU {requestKey:UUID,planId}. Bukan kedua jenis sekaligus.
Harga/seller/fee/paket snapshot dari DB. Idempotency key yang sama harus payload yang sama.
GET /orders?offset=0; GET /orders/:id -> items, versi proof, delivery decrypted jika PAID.
POST /orders/:id/proof multipart file; authenticated CSRF; hanya AWAITING_PAYMENT atau REJECTED.
JPEG/PNG/WebP/PDF maksimum 5 MB, nama/ext/MIME/magic bytes cocok.
GET /media/:id: public website asset atau pemilik proof/admin. Private proof attachment.
GET /notifications; POST /notifications/:id/read {}.
GET /dashboard; GET /dashboard/events (SSE, setiap 10 detik, session direvalidasi).

## Reseller (ownership enforced)
GET /reseller/products
POST /reseller/products {title,description,category,price} -> unapproved, stok 0.
PATCH /reseller/products/:id payload sama -> kembali unapproved.
POST /reseller/products/:id/stock {units:["kode/link/payload"]}, 1–100 unit, tiap unit <=10k karakter.
Jangan kirim password akun pribadi atau kredensial yang tidak boleh diperjualbelikan.
GET /reseller/ledger; GET /reseller/sales. Ledger hanya milik user aktif.
Pembuatan produk dan stok membutuhkan paket aktif bagi RESELLER; Admin tidak perlu paket.

## Admin
GET /admin/users; GET /admin/products; GET /admin/orders; GET /admin/ledger; GET /admin/audit.
POST /admin/products/:id/review {approved:boolean,active:boolean}.
GET /admin/proofs/:id/media -> {id,mime} lalu GET /media/:id.
POST /admin/payment-proofs/:id/review {approve:true} ATAU {approve:false,reason:3–1000 chars}.
POST /admin/notifications {userId,message} -> satu notifikasi in-app.
GET /admin/plans; GET /admin/promos.

## Super Admin
PATCH /admin/users/:id {role:CUSTOMER|RESELLER|ADMIN|SUPER_ADMIN,active:boolean}; self edit ditolak.
Role RESELLER saja tidak memberi paket aktif; membeli paket atau operasikan data paket secara sah.
PATCH /admin/settings/:key {value:JSON}; key name,terms,maintenance,categories,logo,banner,qris.
Logo/banner/qris berupa Media.id yang public dan image atau null.
POST /admin/media multipart file, hanya image public.
POST /admin/plans; PATCH /admin/plans/:id:
{name,price,durationDays:number|null,productLimit,platformFeeBps:0..10000,active:boolean}.
POST /admin/promos {code:uppercase,percent:1..90,expiresAt:ISO8601,active:boolean}; upsert by code.

## Error
400 validasi; 401 login/session; 403 role/origin/CSRF; 404 missing/ownership;
409 conflict, stock, stale proof, idempotency; 429 rate limit; 503 maintenance/SMTP missing; 500 generic.
Respons {error:string}; Zod errors juga issues. Tidak mengirim stack atau DB credential.

## Tambahan RC1
GET /admin/readiness (Super Admin): checks DB/migration, private storage, consistency stock/unit.
Response 503 generic jika gagal; diagnosis lokal lewat npm run readiness.
Semua HTTP response memiliki X-Request-ID untuk korelasi log tanpa secret/body/query.
Endpoint write paket/promo/notification/review produk menggunakan service bersama dengan bot,
serta audit atomik untuk operasi tersebut. Form web tidak lagi memerlukan JSON manual.
