# Liminal Campervan Bar - Sistem Point of Sale (POS)

Aplikasi web Point of Sale (POS) produksi untuk **Liminal Campervan Bar (Terminal Muntilan)**. Dirancang khusus untuk digunakan di **Tablet Android** maupun browser desktop dengan dukungan antrean offline lokal (IndexedDB + Service Worker) saat sinyal internet di sekitar kafe padat atau tidak stabil, database **MySQL 8**, dan sinkronisasi otomatis ke **Google Sheets**.

---

## 1. Struktur Proyek

```text
campervan-cafe/
├── database/
│   ├── campervan_cafe.sql      # Skema lengkap MySQL 8 (InnoDB, utf8mb4, FK & constraint)
│   └── seed.ts                 # Seeder akun default (bcrypt) & 26 menu Liminal Campervan Bar
├── scripts/
│   ├── backup.ts               # Utilitas backup & restore database (JSON snapshot)
│   ├── set-password.ts         # CLI untuk mengganti password user (admin / kasir)
│   └── test-flow.ts            # Pengujian otomatis End-to-End (19 skenario wajib)
├── credentials/
│   └── .gitkeep                # Folder penyimpanan service-account.json (diabaikan Git)
├── public/
│   ├── manifest.webmanifest    # Manifest PWA untuk instalasi di Tablet Android
│   ├── sw.js                   # Service Worker untuk caching shell saat sinyal putus
│   └── qris-default.svg        # Placeholder jujur sebelum QRIS asli kafe diunggah
├── src/
│   ├── instrumentation.ts      # Penjadwal node-cron untuk worker sinkronisasi Google Sheets
│   ├── lib/
│   │   ├── format.ts           # Formatter Rupiah & zona waktu Asia/Jakarta (WIB)
│   │   ├── offline.ts          # Penyimpanan IndexedDB & outbox transaksi offline tablet
│   │   └── schemas.ts          # Skema validasi Zod (client & server)
│   ├── server/
│   │   ├── db.ts               # Koneksi pool MySQL2 & helper transaksi atomik
│   │   ├── session.ts          # Autentikasi sesi terenkripsi (iron-session)
│   │   ├── api.ts              # Guard CSRF, autentikasi, otorisasi role, & error handler
│   │   ├── time.ts             # Konversi rentang tanggal WIB ke UTC untuk query berindeks
│   │   ├── upload.ts           # Validasi magic-bytes gambar (JPG/PNG/WEBP, maks. 2 MB)
│   │   ├── googleSheets.ts     # Integrasi Google Sheets API v4 & idempotent row upsert
│   │   ├── syncWorker.ts       # Worker antrean sync_queue dengan exponential backoff
│   │   └── repo/
│   │       ├── catalog.ts      # Repository kategori & produk (termasuk soft-deactivation)
│   │       ├── orders.ts       # Transaksi ACC pesanan, Order Pending/Selesai, & laporan
│   │       └── settings.ts     # Pengaturan nama kafe & gambar QRIS statis di MySQL
│   ├── components/
│   │   ├── AppShell.tsx        # Navigasi responsif (Sidebar Desktop + Bar Kasir Tablet)
│   │   ├── PosWorkspace.tsx    # Antarmuka Buat Pesanan, Keranjang, & Modal Pembayaran/ACC
│   │   ├── OrdersBoard.tsx     # Manajemen Order Pending & Order Selesai
│   │   ├── CatalogManager.tsx  # CRUD Produk & Kategori (khusus Admin)
│   │   └── ReportsView.tsx     # Laporan Penjualan Harian & Bulanan + Chart.js
│   └── app/
│       ├── login/page.tsx
│       ├── (protected)/
│       │   ├── dashboard/page.tsx
│       │   ├── pos/page.tsx
│       │   ├── payment/page.tsx
│       │   ├── orders/pending/page.tsx
│       │   ├── orders/completed/page.tsx
│       │   ├── menu/page.tsx
│       │   ├── categories/page.tsx
│       │   ├── reports/page.tsx
│       │   ├── reports/daily/page.tsx
│       │   ├── reports/monthly/page.tsx
│       │   └── settings/page.tsx
│       └── api/                # Endpoint REST API terproteksi
├── DESIGN.md                   # Dokumentasi arah desain, kontras WCAG AA, & tipografi
├── .env.example                # Template variabel lingkungan
└── package.json
```

---

## 2. Instalasi Database MySQL 8

1. Pastikan **MySQL 8.0+** sudah berjalan (lokal atau cloud seperti Railway MySQL / TiDB Cloud / Aiven).
2. Salin file `.env.example` menjadi `.env` dan sesuaikan konfigurasi koneksi MySQL Anda:
   ```bash
   cp .env.example .env
   ```
3. Jalankan perintah instalasi skema dan data awal (26 menu Liminal Campervan Bar + akun default):
   ```bash
   npm install
   npm run db:setup
   ```
   Jika ingin mengimpor file SQL secara manual:
   ```bash
   mysql -u root -p < database/campervan_cafe.sql
   npm run db:seed
   ```

---

## 3. Konfigurasi Environment (`.env`)

Buka file `.env` dan atur variabel berikut sebelum digunakan di produksi:

```ini
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=campervan
DB_PASSWORD=password_mysql_anda
DB_NAME=campervan_cafe
DB_SSL=false

# Wajib minimal 32 karakter acak
SESSION_SECRET=ganti_dengan_string_acak_minimal_32_karakter_xxxxxxxx
SESSION_HOURS=14

# Kredensial awal saat menjalankan npm run db:seed
SEED_ADMIN_NAME=Admin
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=ganti_password_admin
SEED_KASIR_NAME=Kasir
SEED_KASIR_USERNAME=kasir
SEED_KASIR_PASSWORD=ganti_password_kasir

# Opsional: Google Sheets API
GOOGLE_SHEETS_SPREADSHEET_ID=
GOOGLE_APPLICATION_CREDENTIALS=./credentials/service-account.json
GOOGLE_SERVICE_ACCOUNT_JSON_BASE64=

SYNC_WORKER_ENABLED=true
CRON_SECRET=ganti_dengan_string_acak
APP_TIMEZONE=Asia/Jakarta
```

---

## 4. Akun Admin & Kasir Default serta Cara Menggantinya

Saat `npm run db:setup` dijalankan, sistem membuat dua akun dengan password yang di-hash menggunakan **bcrypt (cost 12)**:

- **Admin**: username `admin` (akses penuh: Dashboard, Buat Pesanan, Order Pending, Order Selesai, Menu & Kategori, Laporan Penjualan, Pengaturan).
- **Kasir**: username `kasir` (akses operasional kasir: Dashboard, Buat Pesanan, Verifikasi Pembayaran & ACC, Order Pending, Order Selesai, dan Ubah Password sendiri).

**Cara mengganti password sebelum atau sesudah deployment:**
1. Melalui antarmuka web: Buka menu **Pengaturan** -> **Ubah Password**.
2. Melalui terminal:
   ```bash
   npm run user:password -- admin PasswordBaruAdminYangKuat
   npm run user:password -- kasir PasswordBaruKasirYangKuat
   ```

---

## 5. Panduan Konfigurasi Google Sheets Otomatis

Sinkronisasi bersifat **non-blocking**: jika kredensial belum diisi atau internet sedang putus, transaksi kasir tetap berjalan normal dan masuk ke tabel `sync_queue`.

1. **Buat Project Google Cloud**:
   - Buka [Google Cloud Console](https://console.cloud.google.com/) dan buat project baru.
2. **Aktifkan Google Sheets API**:
   - Masuk ke **APIs & Services -> Library**, cari **Google Sheets API**, lalu klik **Enable**.
3. **Buat Service Account**:
   - Masuk ke **APIs & Services -> Credentials -> Create Credentials -> Service Account**.
   - Buka Service Account yang baru dibuat -> tab **Keys -> Add Key -> Create new key -> JSON**.
   - Simpan file JSON yang terunduh ke `credentials/service-account.json` (atau encode ke Base64 untuk variabel `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` jika di-deploy ke cloud).
4. **Siapkan Spreadsheet**:
   - Buat Google Spreadsheet baru bernama **`Campervan Cafe - Laporan Penjualan`**.
   - Klik tombol **Share (Bagikan)** di pojok kanan atas Spreadsheet, lalu tambahkan alamat email Service Account (`client_email` di dalam file JSON) sebagai **Editor**.
   - Salin **Spreadsheet ID** dari URL (`https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`) ke variabel `GOOGLE_SHEETS_SPREADSHEET_ID` di `.env`.
5. **Empat Sheet Dibuat Otomatis**:
   - Saat sinkronisasi berjalan, aplikasi otomatis memastikan keempat sheet tersedia beserta kolom header-nya:
     - `Pesanan`
     - `Detail Pesanan`
     - `Rekap Harian`
     - `Rekap Bulanan`

---

## 6. Perintah Menjalankan Aplikasi & Backup Database

```bash
# Mode pengembangan (dapat diakses dari Tablet Android di jaringan yang sama)
npm run dev

# Build & jalankan untuk produksi
npm run build
npm run start

# Backup seluruh tabel database ke folder backups/
npm run db:backup

# Restore database dari file backup
npm run db:backup -- restore backups/nama_file_backup.json

# Jalankan pengujian fungsional otomatis (19 skenario)
npm run test:flow
```
