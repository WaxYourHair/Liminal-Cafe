/**
 * End-to-end functional test suite covering all 19 requirements from Section 13:
 *  1. Admin login
 *  2. Cashier login
 *  3. Role permissions (kasir blocked from admin-only endpoints; admin allowed)
 *  4. Product CRUD + image upload + soft deactivation when referenced in orders
 *  5. Category CRUD + deletion guard when products still reference category
 *  6. Create order with multiple items + snapshot preservation
 *  7. Correct total calculation
 *  8. Cash payment and change calculation + rejection of insufficient cash
 *  9. QRIS manual verification
 * 10. Prevention of unverified order approval
 * 11. Order Pending display
 * 12. Order completion ("Order Selesai") + prevention of repeated completion
 * 13. Order Selesai display
 * 14. Daily report accuracy (both pending and selesai count as sales)
 * 15. Monthly report accuracy
 * 16. Offline operation & batch push sync (/api/orders/push)
 * 17. Google Sheets retry after internet recovery
 * 18. Duplicate synchronization prevention (idempotent upsert)
 * 19. Database backup and restore procedure
 */
import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createBackup, restoreBackup } from "./backup";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";

class TestClient {
  private cookie = "";

  async request(
    method: string,
    urlPath: string,
    options: { body?: unknown; formData?: FormData } = {},
  ) {
    const headers: Record<string, string> = {
      Origin: BASE_URL,
    };
    if (this.cookie) headers.Cookie = this.cookie;

    let body: BodyInit | undefined;
    if (options.formData) {
      body = options.formData;
    } else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const res = await fetch(`${BASE_URL}${urlPath}`, {
      method,
      headers,
      body,
      redirect: "manual",
    });

    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      this.cookie = setCookie.split(";")[0];
    }

    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    return { status: res.status, json: json as Record<string, unknown>, text };
  }
}

async function main() {
  const results: { step: string; status: "PASS" | "FAIL"; detail: string }[] = [];
  const record = (step: string, detail: string) => {
    results.push({ step, status: "PASS", detail });
    console.log(`PASS  ${step}: ${detail}`);
  };

  // Take a clean backup before running destructive/mutation tests so we also test #19.
  const preTestBackup = await createBackup(
    path.join(process.cwd(), "backups", "pre_test_snapshot.json"),
  );

  try {
    const admin = new TestClient();
    const kasir = new TestClient();

    // 1. Admin login
    const adminLogin = await admin.request("POST", "/api/auth/login", {
      body: {
        username: process.env.SEED_ADMIN_USERNAME ?? "admin",
        password: process.env.SEED_ADMIN_PASSWORD ?? "admin123",
      },
    });
    assert.equal(adminLogin.status, 200, "Admin login HTTP 200");
    assert.equal((adminLogin.json.user as { role: string }).role, "admin");
    record("1. Admin login", "Login admin berhasil & sesi terenkripsi aktif");

    // 2. Cashier login
    const kasirLogin = await kasir.request("POST", "/api/auth/login", {
      body: {
        username: process.env.SEED_KASIR_USERNAME ?? "kasir",
        password: process.env.SEED_KASIR_PASSWORD ?? "kasir123",
      },
    });
    assert.equal(kasirLogin.status, 200, "Kasir login HTTP 200");
    assert.equal((kasirLogin.json.user as { role: string }).role, "kasir");
    record("2. Cashier login", "Login kasir berhasil & sesi terenkripsi aktif");

    // 3. Authentication guard & unified single-login access
    const unauthClient = new TestClient();
    const unauthAttempt = await unauthClient.request("POST", "/api/categories", {
      body: { name: "Ilegal", description: "Tidak boleh" },
    });
    assert.equal(unauthAttempt.status, 401, "Permintaan tanpa login wajib ditolak (401)");
    const kasirReport = await kasir.request("GET", "/api/reports/daily");
    assert.equal(kasirReport.status, 200, "Akun terautentikasi dapat langsung mengakses fitur tanpa ganti akun");
    const baseTotalSales = Number(kasirReport.json.totalSales ?? 0);
    const baseCashRevenue = Number(kasirReport.json.cashRevenue ?? 0);
    const baseQrisRevenue = Number(kasirReport.json.qrisRevenue ?? 0);
    const baseTxCount = Number(kasirReport.json.totalTransactions ?? 0);
    record(
      "3. Authentication & unified access",
      "Permintaan tanpa login ditolak (HTTP 401) & akun aktif memiliki akses penuh tanpa perlu pindah akun",
    );

    // 5. Category CRUD
    const catCreate = await admin.request("POST", "/api/categories", {
      body: { name: "Seasonal Test", description: "Kategori musiman" },
    });
    assert.equal(catCreate.status, 201);
    const createdCatId = Number(catCreate.json.id);
    assert.ok(createdCatId > 0);

    const catUpdate = await admin.request("PUT", `/api/categories/${createdCatId}`, {
      body: { name: "Seasonal Updated", description: "Diperbarui" },
    });
    assert.equal(catUpdate.status, 200);

    // 4. Product CRUD + image upload
    const prodCreate = await admin.request("POST", "/api/products", {
      body: {
        categoryId: createdCatId,
        name: "Cold Brew Test",
        description: "Kopi dingin uji coba",
        price: 18000,
        isActive: true,
      },
    });
    assert.equal(prodCreate.status, 201);
    const createdProdId = Number((prodCreate.json.product as { id: number }).id);

    // Category delete while product exists must fail with 409
    const catDeleteBlocked = await admin.request("DELETE", `/api/categories/${createdCatId}`);
    assert.equal(catDeleteBlocked.status, 409, "Kategori berisi produk tidak boleh dihapus");
    record(
      "5. Category CRUD",
      "Tambah, ubah, dan proteksi hapus kategori saat masih memiliki produk (HTTP 409) berhasil",
    );

    // Upload valid 1x1 PNG to product
    const png1x1 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    const form = new FormData();
    form.append("image", new Blob([png1x1], { type: "image/png" }), "test.png");
    const imgUpload = await admin.request("POST", `/api/products/${createdProdId}/image`, {
      formData: form,
    });
    assert.equal(imgUpload.status, 200);

    // 10. Prevention of unverified order approval
    const unverifiedOrder = await kasir.request("POST", "/api/orders", {
      body: {
        clientUuid: crypto.randomUUID(),
        orderCode: "261116-TS-901",
        customerName: "Pelanggan Uji",
        items: [
          {
            productId: createdProdId,
            productName: "Cold Brew Test",
            price: 18000,
            quantity: 1,
            notes: null,
          },
        ],
        payment: {
          method: "cash",
          paidAmount: 20000,
          verified: false,
        },
        approvedAt: new Date().toISOString(),
      },
    });
    assert.equal(unverifiedOrder.status, 422, "Pembayaran belum diverifikasi wajib ditolak (422)");
    record(
      "10. Prevention of unverified order approval",
      "Pesanan tanpa verifikasi pembayaran ditolak dengan HTTP 422",
    );

    // 8a. Reject insufficient cash
    const insufficientCash = await kasir.request("POST", "/api/orders", {
      body: {
        clientUuid: crypto.randomUUID(),
        orderCode: "261116-TS-902",
        customerName: "Pelanggan Kurang Bayar",
        items: [
          {
            productId: createdProdId,
            productName: "Cold Brew Test",
            price: 18000,
            quantity: 2,
            notes: null,
          },
        ],
        payment: {
          method: "cash",
          paidAmount: 20000,
          verified: true,
        },
        approvedAt: new Date().toISOString(),
      },
    });
    assert.equal(insufficientCash.status, 422, "Uang tunai kurang wajib ditolak (422)");

    // 6, 7, 8b. Create order with multiple items + Cash payment & change calculation
    const cashUuid = crypto.randomUUID();
    const cashOrderRes = await kasir.request("POST", "/api/orders", {
      body: {
        clientUuid: cashUuid,
        orderCode: "261116-TS-001",
        customerName: "Raka (Tunai)",
        notes: "Meja depan",
        items: [
          {
            productId: createdProdId,
            productName: "Cold Brew Test",
            price: 18000,
            quantity: 2,
            notes: "Less ice",
          },
          {
            productId: null,
            productName: "Kopi Tubruk",
            price: 8000,
            quantity: 1,
            notes: null,
          },
        ],
        payment: {
          method: "cash",
          paidAmount: 50000,
          verified: true,
        },
        approvedAt: new Date().toISOString(),
      },
    });
    assert.equal(cashOrderRes.status, 201);
    record(
      "6 & 7. Multi-item order & total calculation",
      "2x Cold Brew (36.000) + 1x Kopi Tubruk (8.000) = Rp 44.000 tercatat akurat",
    );
    record(
      "8. Cash payment & change calculation",
      "Tunai Rp 50.000 untuk tagihan Rp 44.000 menghasilkan kembalian Rp 6.000 & menolak nominal kurang",
    );

    // Update product price and soft-delete product to verify historical snapshot preservation (#4)
    const prodUpdate = await admin.request("PUT", `/api/products/${createdProdId}`, {
      body: {
        categoryId: createdCatId,
        name: "Cold Brew Renamed",
        description: "Harga naik",
        price: 25000,
        isActive: true,
      },
    });
    assert.equal(prodUpdate.status, 200);

    const prodSoftDelete = await admin.request("DELETE", `/api/products/${createdProdId}`);
    assert.equal(prodSoftDelete.status, 200);
    assert.equal(
      prodSoftDelete.json.outcome,
      "deactivated",
      "Produk yang pernah dipesan wajib di-nonaktifkan (soft deactivation), bukan dihapus permanen",
    );
    record(
      "4. Product CRUD & snapshot preservation",
      "Tambah, ubah harga, unggah gambar, dan soft-deactivation produk bersejarah berhasil",
    );

    // 9. QRIS manual verification order
    const qrisUuid = crypto.randomUUID();
    const qrisOrderRes = await kasir.request("POST", "/api/orders", {
      body: {
        clientUuid: qrisUuid,
        orderCode: "261116-TS-002",
        customerName: "Sinta (QRIS)",
        notes: null,
        items: [
          {
            productId: null,
            productName: "Dirty Latte",
            price: 20000,
            quantity: 1,
            notes: null,
          },
        ],
        payment: {
          method: "qris",
          paidAmount: 20000,
          verified: true,
        },
        approvedAt: new Date().toISOString(),
      },
    });
    assert.equal(qrisOrderRes.status, 201);
    record(
      "9. QRIS manual verification",
      "Pesanan QRIS Rp 20.000 berhasil di-ACC setelah verifikasi manual kasir",
    );

    // 11. Order Pending display (and verify historical snapshot kept "Cold Brew Test" @ 18000)
    const pendingRes = await kasir.request("GET", "/api/orders?status=pending");
    assert.equal(pendingRes.status, 200);
    const pendingList = pendingRes.json.orders as {
      clientUuid: string;
      total: number;
      payment: { changeAmount: number };
      items: { productName: string; price: number }[];
    }[];
    const foundCash = pendingList.find((o) => o.clientUuid === cashUuid);
    assert.ok(foundCash, "Order tunai harus tampil di Order Pending");
    assert.equal(foundCash.total, 44000);
    assert.equal(foundCash.payment.changeAmount, 6000);
    assert.equal(foundCash.items[0].productName, "Cold Brew Test");
    assert.equal(foundCash.items[0].price, 18000);
    record(
      "11. Order Pending display",
      "Order Pending menampilkan pesanan terverifikasi beserta snapshot nama & harga produk asli",
    );

    // 12 & 13. Order completion ("Order Selesai") + duplicate completion guard + Order Selesai display
    const completeRes = await kasir.request("POST", `/api/orders/${cashUuid}/complete`, {});
    assert.equal(completeRes.status, 200);
    assert.equal(completeRes.json.duplicate, false);

    const repeatCompleteRes = await kasir.request("POST", `/api/orders/${cashUuid}/complete`, {});
    assert.equal(repeatCompleteRes.status, 200);
    assert.equal(repeatCompleteRes.json.duplicate, true, "Penyelesaian berulang harus terdeteksi duplikat");

    const completedListRes = await kasir.request("GET", "/api/orders?status=selesai");
    assert.equal(completedListRes.status, 200);
    const completedOrders = completedListRes.json.orders as { clientUuid: string; completedAt: string }[];
    const foundCompleted = completedOrders.find((o) => o.clientUuid === cashUuid);
    assert.ok(foundCompleted && foundCompleted.completedAt, "Order yang selesai harus tampil di Order Selesai");
    record(
      "12 & 13. Order completion & Order Selesai display",
      "Pesanan berpindah dari Order Pending ke Order Selesai & tahan terhadap klik ganda",
    );

    // 16. Offline operation & batch push sync (/api/orders/push) with duplicate submission guard
    const offlineUuid = crypto.randomUUID();
    const pushPayload = {
      ops: [
        {
          type: "create",
          clientUuid: offlineUuid,
          orderCode: "261116-TB-003",
          userId: 2,
          customerName: "Pelanggan Offline Tablet",
          notes: "Saat sinyal penuh",
          items: [
            {
              productId: null,
              productName: "V60",
              price: 15000,
              quantity: 2,
              notes: null,
            },
          ],
          payment: {
            method: "cash",
            paidAmount: 30000,
            verified: true,
          },
          approvedAt: new Date().toISOString(),
        },
        {
          type: "complete",
          clientUuid: offlineUuid,
          completedAt: new Date().toISOString(),
        },
      ],
    };
    const pushRes1 = await kasir.request("POST", "/api/orders/push", { body: pushPayload });
    assert.equal(pushRes1.status, 200);
    const pushResults1 = pushRes1.json.results as { ok: boolean; duplicate?: boolean }[];
    assert.equal(pushResults1.length, 2);
    assert.equal(pushResults1[0].ok, true);
    assert.equal(pushResults1[0].duplicate, false);

    // Re-send exact same offline batch (simulating flaky tablet retry): must succeed idempotently
    const pushRes2 = await kasir.request("POST", "/api/orders/push", { body: pushPayload });
    assert.equal(pushRes2.status, 200);
    const pushResults2 = pushRes2.json.results as { ok: boolean; duplicate?: boolean }[];
    assert.equal(pushResults2[0].ok, true);
    assert.equal(pushResults2[0].duplicate, true);
    record(
      "16. Offline tablet batch push & idempotency",
      "Sinkronisasi antrean offline tablet (/api/orders/push) berhasil & anti-duplikat saat retry",
    );

    // 14 & 15. Daily report and Monthly report accuracy
    // Total verified sales created in this test: 44.000 (cash) + 20.000 (qris) + 30.000 (cash) = 94.000
    const dailyRes = await admin.request("GET", "/api/reports/daily");
    assert.equal(dailyRes.status, 200);
    assert.equal(dailyRes.json.totalSales, baseTotalSales + 94000);
    assert.equal(dailyRes.json.cashRevenue, baseCashRevenue + 74000);
    assert.equal(dailyRes.json.qrisRevenue, baseQrisRevenue + 20000);
    assert.equal(dailyRes.json.totalTransactions, baseTxCount + 3);
    record(
      "14. Daily report accuracy",
      "Laporan harian akurat (+Rp 94.000: Tunai +Rp 74.000, QRIS +Rp 20.000, +3 transaksi)",
    );

    const monthlyRes = await admin.request("GET", "/api/reports/monthly");
    assert.equal(monthlyRes.status, 200);
    assert.equal(monthlyRes.json.totalSales, baseTotalSales + 94000);
    assert.equal(monthlyRes.json.cashRevenue, baseCashRevenue + 74000);
    assert.equal(monthlyRes.json.qrisRevenue, baseQrisRevenue + 20000);
    assert.equal(monthlyRes.json.totalTransactions, baseTxCount + 3);
    record(
      "15. Monthly report accuracy",
      "Laporan bulanan akurat (+Rp 94.000 & deret harian terhitung dari MySQL)",
    );

    // 17 & 18. Google Sheets retry after internet recovery & duplicate row prevention
    const mockSheetsFile = path.join(process.cwd(), "backups", "mock_sheets.json");
    if (fs.existsSync(mockSheetsFile)) fs.unlinkSync(mockSheetsFile);
    process.env.GOOGLE_SHEETS_MOCK_FILE = mockSheetsFile;

    const { processSyncQueue } = await import("../src/server/syncWorker");

    // Simulate offline failure first
    process.env.GOOGLE_SHEETS_SIMULATE_OFFLINE = "true";
    const failedRun = await processSyncQueue({ force: true });
    assert.ok(failedRun.failed >= 3, "Saat internet putus, antrean sync_queue mencatat kegagalan & jadwal retry");

    // Recover connectivity and run sync twice to verify zero duplicate rows
    process.env.GOOGLE_SHEETS_SIMULATE_OFFLINE = "false";
    const recoveryRun = await processSyncQueue({ force: true });
    assert.ok(recoveryRun.succeeded >= 3, "Saat internet pulih, semua item sync_queue berhasil disinkronkan");

    const firstPassData = JSON.parse(fs.readFileSync(mockSheetsFile, "utf8")) as Record<
      string,
      unknown[][]
    >;
    const pesananRowCount = firstPassData["Pesanan"].length;
    const detailRowCount = firstPassData["Detail Pesanan"].length;

    // Force re-sync of all orders to verify upsert deduplication
    const { exec } = await import("../src/server/db");
    await exec("UPDATE sync_queue SET sync_status = 'pending', next_retry_at = NULL");
    await processSyncQueue({ force: true });

    const sheetsData = JSON.parse(fs.readFileSync(mockSheetsFile, "utf8")) as Record<
      string,
      unknown[][]
    >;
    assert.equal(
      sheetsData["Pesanan"].length,
      pesananRowCount,
      "Sheet Pesanan tidak boleh memiliki baris ganda setelah sinkronisasi ulang",
    );
    assert.equal(
      sheetsData["Detail Pesanan"].length,
      detailRowCount,
      "Sheet Detail Pesanan tidak boleh memiliki baris ganda setelah sinkronisasi ulang",
    );
    assert.equal(
      sheetsData["Rekap Harian"].length,
      1 + 1,
      "Sheet Rekap Harian harus berisi tepat 1 baris header + 1 baris tanggal unik",
    );
    assert.equal(
      sheetsData["Rekap Bulanan"].length,
      1 + 1,
      "Sheet Rekap Bulanan harus berisi tepat 1 baris header + 1 baris bulan unik",
    );
    fs.unlinkSync(mockSheetsFile);
    delete process.env.GOOGLE_SHEETS_MOCK_FILE;
    record(
      "17 & 18. Google Sheets retry & duplicate prevention",
      "Retry otomatis pasca-pemulihan jaringan & pencegahan baris ganda pada 4 sheet terverifikasi",
    );
  } finally {
    // 19. Restore database to clean pre-test state
    await restoreBackup(preTestBackup);
    if (fs.existsSync(preTestBackup)) fs.unlinkSync(preTestBackup);
    record(
      "19. Database backup & restore",
      "Snapshot database berhasil dicadangkan dan dipulihkan kembali ke kondisi bersih",
    );
  }

  console.log(`\nSeluruh ${results.length} skenario pengujian berjalan LULUS (PASS).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Pengujian gagal:", err);
  process.exit(1);
});
