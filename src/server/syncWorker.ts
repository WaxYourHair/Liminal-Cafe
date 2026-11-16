import "server-only";
import { exec, query, queryOne } from "./db";
import { dayRangeUtc, monthRangeUtc } from "./time";
import { formatDateTime, jakartaDateKey, MONTHS_ID, paymentLabel } from "@/lib/format";
import { isGoogleSheetsConfigured, upsertSheetRows } from "./googleSheets";

interface QueueRow {
  id: number;
  order_id: number | null;
  event_key: string;
  event_type: string;
  retry_count: number;
}

let running = false;

async function syncSingleOrder(orderId: number) {
  const order = await queryOne<{
    id: number;
    order_code: string;
    customer_name: string | null;
    total: number;
    approved_at: Date;
    payment_method: string;
    payment_status: string;
    cashier_name: string;
  }>(
    `SELECT o.id, o.order_code, o.customer_name, o.total, o.approved_at,
            p.payment_method, p.payment_status, u.name AS cashier_name
       FROM orders o
       JOIN payments p ON p.order_id = o.id
       JOIN users u ON u.id = o.user_id
      WHERE o.id = ? AND p.payment_status = 'verified'`,
    [orderId],
  );
  if (!order) return;

  const items = await query<{
    id: number;
    product_name: string;
    quantity: number;
    price: number;
    subtotal: number;
    notes: string | null;
  }>(
    `SELECT id, product_name, quantity, price, subtotal, notes
       FROM order_items WHERE order_id = ? ORDER BY id ASC`,
    [orderId],
  );

  await upsertSheetRows("Pesanan", [
    [
      order.id,
      order.order_code,
      formatDateTime(order.approved_at),
      order.customer_name ?? "-",
      Number(order.total),
      paymentLabel(order.payment_method),
      order.payment_status,
      order.cashier_name,
    ],
  ]);

  if (items.length > 0) {
    await upsertSheetRows(
      "Detail Pesanan",
      items.map((it) => [
        it.id,
        order.order_code,
        it.product_name,
        Number(it.quantity),
        Number(it.price),
        Number(it.subtotal),
        it.notes ?? "-",
      ]),
    );
  }

  const dateKey = jakartaDateKey(order.approved_at);
  const { start: dStart, end: dEnd } = dayRangeUtc(dateKey);
  const daily = await queryOne<{
    order_count: number;
    cash_revenue: number;
    qris_revenue: number;
    total_revenue: number;
  }>(
    `SELECT
       COUNT(o.id) AS order_count,
       COALESCE(SUM(CASE WHEN p.payment_method = 'cash' THEN o.total ELSE 0 END), 0) AS cash_revenue,
       COALESCE(SUM(CASE WHEN p.payment_method = 'qris' THEN o.total ELSE 0 END), 0) AS qris_revenue,
       COALESCE(SUM(o.total), 0) AS total_revenue
     FROM orders o
     JOIN payments p ON p.order_id = o.id
     WHERE p.payment_status = 'verified' AND o.approved_at >= ? AND o.approved_at < ?`,
    [dStart, dEnd],
  );

  await upsertSheetRows("Rekap Harian", [
    [
      dateKey,
      Number(daily?.order_count ?? 0),
      Number(daily?.cash_revenue ?? 0),
      Number(daily?.qris_revenue ?? 0),
      Number(daily?.total_revenue ?? 0),
    ],
  ]);

  const [yearNum, monthNum] = dateKey.split("-").map(Number);
  const { start: mStart, end: mEnd } = monthRangeUtc(yearNum, monthNum);
  const monthly = await queryOne<{
    order_count: number;
    cash_revenue: number;
    qris_revenue: number;
    total_revenue: number;
  }>(
    `SELECT
       COUNT(o.id) AS order_count,
       COALESCE(SUM(CASE WHEN p.payment_method = 'cash' THEN o.total ELSE 0 END), 0) AS cash_revenue,
       COALESCE(SUM(CASE WHEN p.payment_method = 'qris' THEN o.total ELSE 0 END), 0) AS qris_revenue,
       COALESCE(SUM(o.total), 0) AS total_revenue
     FROM orders o
     JOIN payments p ON p.order_id = o.id
     WHERE p.payment_status = 'verified' AND o.approved_at >= ? AND o.approved_at < ?`,
    [mStart, mEnd],
  );

  await upsertSheetRows("Rekap Bulanan", [
    [
      MONTHS_ID[monthNum - 1] ?? String(monthNum),
      yearNum,
      Number(monthly?.order_count ?? 0),
      Number(monthly?.cash_revenue ?? 0),
      Number(monthly?.qris_revenue ?? 0),
      Number(monthly?.total_revenue ?? 0),
    ],
  ]);
}

export async function processSyncQueue(options: { force?: boolean; limit?: number } = {}) {
  if (running) {
    return { processed: 0, succeeded: 0, failed: 0, skipped: true, reason: "Sinkronisasi sedang berjalan." };
  }
  if (!isGoogleSheetsConfigured()) {
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: true,
      reason: "Google Sheets belum dikonfigurasi (opsional saat pengembangan lokal).",
    };
  }

  running = true;
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  try {
    const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
    const dueClause = options.force
      ? "sync_status IN ('pending', 'failed')"
      : "sync_status IN ('pending', 'failed') AND (next_retry_at IS NULL OR next_retry_at <= UTC_TIMESTAMP())";

    const rows = await query<QueueRow>(
      `SELECT id, order_id, event_key, event_type, retry_count
         FROM sync_queue
        WHERE ${dueClause}
          AND (locked_until IS NULL OR locked_until < UTC_TIMESTAMP())
        ORDER BY id ASC
        LIMIT ${limit}`,
    );

    for (const row of rows) {
      processed += 1;
      await exec(
        "UPDATE sync_queue SET locked_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 MINUTE) WHERE id = ?",
        [row.id],
      );

      try {
        if (row.order_id) {
          await syncSingleOrder(row.order_id);
        }
        await exec(
          `UPDATE sync_queue
              SET sync_status = 'synced',
                  synced_at = UTC_TIMESTAMP(),
                  last_error = NULL,
                  next_retry_at = NULL,
                  locked_until = NULL
            WHERE id = ?`,
          [row.id],
        );
        succeeded += 1;
      } catch (err) {
        failed += 1;
        const nextRetryCount = Number(row.retry_count ?? 0) + 1;
        const backoffMinutes = Math.min(30, Math.pow(2, Math.min(nextRetryCount - 1, 4)));
        const message = err instanceof Error ? err.message : String(err);
        await exec(
          `UPDATE sync_queue
              SET sync_status = ?,
                  retry_count = ?,
                  last_error = ?,
                  next_retry_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE),
                  locked_until = NULL
            WHERE id = ?`,
          [
            nextRetryCount >= 3 ? "failed" : "pending",
            nextRetryCount,
            message.slice(0, 1000),
            backoffMinutes,
            row.id,
          ],
        );
      }
    }

    return { processed, succeeded, failed, skipped: false };
  } finally {
    running = false;
  }
}

export async function getSyncQueueOverview() {
  const summary = await queryOne<{
    pending_count: number;
    synced_count: number;
    failed_count: number;
    last_synced_at: Date | null;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN sync_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
       COALESCE(SUM(CASE WHEN sync_status = 'synced' THEN 1 ELSE 0 END), 0) AS synced_count,
       COALESCE(SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_count,
       MAX(synced_at) AS last_synced_at
     FROM sync_queue`,
  );

  const recentItems = await query<{
    id: number;
    order_id: number | null;
    event_key: string;
    sync_status: "pending" | "synced" | "failed";
    retry_count: number;
    last_error: string | null;
    next_retry_at: Date | null;
    synced_at: Date | null;
    updated_at: Date;
  }>(
    `SELECT id, order_id, event_key, sync_status, retry_count, last_error, next_retry_at, synced_at, updated_at
       FROM sync_queue
      ORDER BY id DESC
      LIMIT 25`,
  );

  return {
    configured: isGoogleSheetsConfigured(),
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? "",
    pending: Number(summary?.pending_count ?? 0),
    synced: Number(summary?.synced_count ?? 0),
    failed: Number(summary?.failed_count ?? 0),
    lastSyncedAt: summary?.last_synced_at ? summary.last_synced_at.toISOString() : null,
    items: recentItems.map((it) => ({
      id: it.id,
      orderId: it.order_id,
      eventKey: it.event_key,
      status: it.sync_status,
      retryCount: it.retry_count,
      lastError: it.last_error,
      nextRetryAt: it.next_retry_at ? it.next_retry_at.toISOString() : null,
      syncedAt: it.synced_at ? it.synced_at.toISOString() : null,
      updatedAt: it.updated_at.toISOString(),
    })),
  };
}
