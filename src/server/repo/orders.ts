import "server-only";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { query, queryOne, withTransaction } from "../db";
import { HttpError } from "../api";
import { dayRangeUtc, jakartaDateSql, monthRangeUtc } from "../time";
import { jakartaDateKey } from "@/lib/format";
import type { CreateOrderOp, OrderView } from "@/lib/schemas";

interface OrderHeaderRow extends RowDataPacket {
  id: number;
  client_uuid: string;
  order_code: string;
  customer_name: string | null;
  notes: string | null;
  status: "pending" | "selesai";
  total: number;
  approved_at: Date;
  completed_at: Date | null;
  cashier_name: string;
  payment_method: "cash" | "qris";
  payment_status: "pending" | "verified" | "rejected";
  paid_amount: number;
  change_amount: number;
  verified_by_name: string | null;
  paid_at: Date | null;
}

interface OrderItemRow extends RowDataPacket {
  id: number;
  order_id: number;
  product_id: number | null;
  product_name: string;
  price: number;
  quantity: number;
  subtotal: number;
  notes: string | null;
}

async function resolveUniqueOrderCode(conn: PoolConnection, requestedCode: string): Promise<string> {
  const [existing] = await conn.execute<RowDataPacket[]>(
    "SELECT id FROM orders WHERE order_code = ? LIMIT 1",
    [requestedCode],
  );
  if (existing.length === 0) return requestedCode;

  const prefix = requestedCode.slice(0, 10); // YYMMDD-XX-
  const [rows] = await conn.execute<RowDataPacket[]>(
    "SELECT order_code FROM orders WHERE order_code LIKE ? ORDER BY order_code DESC LIMIT 1",
    [`${prefix}%`],
  );
  let nextNum = 1;
  if (rows.length > 0) {
    const lastPart = String(rows[0].order_code).split("-").pop() ?? "0";
    const parsed = Number.parseInt(lastPart, 10);
    if (!Number.isNaN(parsed)) nextNum = parsed + 1;
  }
  return `${prefix}${String(nextNum).padStart(3, "0")}`;
}

async function enqueueOrderSync(conn: PoolConnection, orderId: number, orderCode: string) {
  const eventKey = `order_sync:${orderId}`;
  const payload = JSON.stringify({ orderId, orderCode });
  await conn.execute(
    `INSERT INTO sync_queue (order_id, event_key, event_type, payload, sync_status, next_retry_at)
     VALUES (?, ?, 'ORDER_SYNC', CAST(? AS JSON), 'pending', UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       payload = VALUES(payload),
       sync_status = 'pending',
       next_retry_at = UTC_TIMESTAMP(),
       locked_until = NULL`,
    [orderId, eventKey, payload],
  );
}

/**
 * Atomically records a verified payment, creates the approved order in `pending` status,
 * stores item snapshots, and queues Google Sheets synchronization.
 */
export async function approveAndCreateOrder(
  op: CreateOrderOp,
  actingUserId: number,
): Promise<{ orderId: number; orderCode: string; duplicate: boolean }> {
  if (!op.payment.verified) {
    throw new HttpError(422, "Pembayaran belum diverifikasi kasir.");
  }

  const computedTotal = op.items.reduce((sum, item) => {
    if (item.price < 0 || item.quantity <= 0) {
      throw new HttpError(422, "Harga dan jumlah item harus bernilai positif.");
    }
    return sum + item.price * item.quantity;
  }, 0);

  const paidAmount = op.payment.method === "qris" ? computedTotal : op.payment.paidAmount;
  if (op.payment.method === "cash" && paidAmount < computedTotal) {
    throw new HttpError(422, "Nominal uang tunai yang diterima kurang dari total tagihan.");
  }
  const changeAmount = op.payment.method === "cash" ? paidAmount - computedTotal : 0;
  const approvedAt = new Date(op.approvedAt);

  return withTransaction(async (conn) => {
    const [existingRows] = await conn.execute<RowDataPacket[]>(
      "SELECT id, order_code FROM orders WHERE client_uuid = ? LIMIT 1 FOR UPDATE",
      [op.clientUuid],
    );
    if (existingRows.length > 0) {
      return {
        orderId: Number(existingRows[0].id),
        orderCode: String(existingRows[0].order_code),
        duplicate: true,
      };
    }

    // Verify user_id exists; fall back to the authenticated session user.
    const [userRows] = await conn.execute<RowDataPacket[]>(
      "SELECT id FROM users WHERE id = ? LIMIT 1",
      [op.userId],
    );
    const cashierId = userRows.length > 0 ? Number(userRows[0].id) : actingUserId;
    const orderCode = await resolveUniqueOrderCode(conn, op.orderCode);

    const [orderRes] = await conn.execute<ResultSetHeader>(
      `INSERT INTO orders
        (client_uuid, user_id, order_code, customer_name, notes, status, total, approved_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        op.clientUuid,
        cashierId,
        orderCode,
        op.customerName,
        op.notes,
        computedTotal,
        approvedAt,
      ],
    );
    const orderId = orderRes.insertId;

    for (const item of op.items) {
      let validProductId: number | null = item.productId;
      if (validProductId !== null) {
        const [prodRows] = await conn.execute<RowDataPacket[]>(
          "SELECT id FROM products WHERE id = ? LIMIT 1",
          [validProductId],
        );
        if (prodRows.length === 0) validProductId = null;
      }
      const subtotal = item.price * item.quantity;
      await conn.execute(
        `INSERT INTO order_items
          (order_id, product_id, product_name, price, quantity, subtotal, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [orderId, validProductId, item.productName, item.price, item.quantity, subtotal, item.notes],
      );
    }

    await conn.execute(
      `INSERT INTO payments
        (order_id, payment_method, payment_status, paid_amount, change_amount, verified_by, paid_at)
       VALUES (?, ?, 'verified', ?, ?, ?, ?)`,
      [orderId, op.payment.method, paidAmount, changeAmount, cashierId, approvedAt],
    );

    await enqueueOrderSync(conn, orderId, orderCode);

    return { orderId, orderCode, duplicate: false };
  });
}

/**
 * Transitions an order from `pending` to `selesai`.
 * Repeated completion requests return `{ duplicate: true }` without overwriting `completed_at`.
 */
export async function completeOrderByUuid(
  clientUuid: string,
  completedAtIso?: string,
): Promise<{ orderId: number; orderCode: string; duplicate: boolean }> {
  const completedAt = completedAtIso ? new Date(completedAtIso) : new Date();

  return withTransaction(async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT o.id, o.order_code, o.status, p.payment_status
         FROM orders o
         JOIN payments p ON p.order_id = o.id
        WHERE o.client_uuid = ?
        LIMIT 1
        FOR UPDATE`,
      [clientUuid],
    );
    if (rows.length === 0) {
      throw new HttpError(404, "Pesanan tidak ditemukan.");
    }
    const row = rows[0];
    if (row.payment_status !== "verified") {
      throw new HttpError(422, "Pesanan belum memiliki pembayaran terverifikasi.");
    }
    if (row.status === "selesai") {
      return {
        orderId: Number(row.id),
        orderCode: String(row.order_code),
        duplicate: true,
      };
    }

    await conn.execute(
      "UPDATE orders SET status = 'selesai', completed_at = ? WHERE id = ? AND status = 'pending'",
      [completedAt, row.id],
    );

    return {
      orderId: Number(row.id),
      orderCode: String(row.order_code),
      duplicate: false,
    };
  });
}

async function attachItems(headers: OrderHeaderRow[]): Promise<OrderView[]> {
  if (headers.length === 0) return [];
  const orderIds = headers.map((h) => h.id);
  const placeholders = orderIds.map(() => "?").join(",");
  const itemRows = await query<OrderItemRow>(
    `SELECT id, order_id, product_id, product_name, price, quantity, subtotal, notes
       FROM order_items
      WHERE order_id IN (${placeholders})
      ORDER BY id ASC`,
    orderIds,
  );

  const byOrder = new Map<number, OrderView["items"]>();
  for (const item of itemRows) {
    const list = byOrder.get(item.order_id) ?? [];
    list.push({
      productName: item.product_name,
      price: Number(item.price),
      quantity: Number(item.quantity),
      subtotal: Number(item.subtotal),
      notes: item.notes,
    });
    byOrder.set(item.order_id, list);
  }

  return headers.map((h) => ({
    id: Number(h.id),
    clientUuid: h.client_uuid,
    orderCode: h.order_code,
    customerName: h.customer_name,
    notes: h.notes,
    status: h.status,
    total: Number(h.total),
    approvedAt: h.approved_at.toISOString(),
    completedAt: h.completed_at ? h.completed_at.toISOString() : null,
    cashierName: h.cashier_name,
    payment: {
      method: h.payment_method,
      status: h.payment_status,
      paidAmount: Number(h.paid_amount),
      changeAmount: Number(h.change_amount),
      verifiedByName: h.verified_by_name,
      paidAt: h.paid_at ? h.paid_at.toISOString() : null,
    },
    items: byOrder.get(h.id) ?? [],
  }));
}

const ORDER_HEADER_SQL = `
  SELECT o.id, o.client_uuid, o.order_code, o.customer_name, o.notes, o.status, o.total,
         o.approved_at, o.completed_at,
         u.name AS cashier_name,
         p.payment_method, p.payment_status, p.paid_amount, p.change_amount, p.paid_at,
         v.name AS verified_by_name
    FROM orders o
    JOIN users u ON u.id = o.user_id
    JOIN payments p ON p.order_id = o.id
    LEFT JOIN users v ON v.id = p.verified_by
`;

export async function listOrders(filter: {
  status?: "pending" | "selesai";
  q?: string;
  dateKey?: string;
  limit?: number;
}): Promise<OrderView[]> {
  const where: string[] = ["p.payment_status = 'verified'", "o.approved_at IS NOT NULL"];
  const params: (string | number | Date)[] = [];

  if (filter.status) {
    where.push("o.status = ?");
    params.push(filter.status);
  }
  if (filter.q) {
    where.push("(o.order_code LIKE ? OR COALESCE(o.customer_name, '') LIKE ?)");
    params.push(`%${filter.q}%`, `%${filter.q}%`);
  }
  if (filter.dateKey) {
    const { start, end } = dayRangeUtc(filter.dateKey);
    const col = filter.status === "selesai" ? "COALESCE(o.completed_at, o.approved_at)" : "o.approved_at";
    where.push(`${col} >= ? AND ${col} < ?`);
    params.push(start, end);
  }

  const orderBy =
    filter.status === "pending"
      ? "ORDER BY o.approved_at ASC, o.id ASC"
      : "ORDER BY COALESCE(o.completed_at, o.approved_at) DESC, o.id DESC";
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500);

  const headers = await query<OrderHeaderRow>(
    `${ORDER_HEADER_SQL} WHERE ${where.join(" AND ")} ${orderBy} LIMIT ${limit}`,
    params,
  );
  return attachItems(headers);
}

export async function getNextOrderSequence(datePrefix: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    "SELECT COUNT(*) + 1 AS n FROM orders WHERE order_code LIKE ?",
    [`${datePrefix}%`],
  );
  return row?.n ?? 1;
}

export async function getDashboardData() {
  const todayKey = jakartaDateKey();
  const { start: todayStart, end: todayEnd } = dayRangeUtc(todayKey);

  const todaySummary = await queryOne<{
    total_sales: number;
    order_count: number;
    cash_revenue: number;
    qris_revenue: number;
    completed_today: number;
  }>(
    `SELECT
       COALESCE(SUM(o.total), 0) AS total_sales,
       COUNT(o.id) AS order_count,
       COALESCE(SUM(CASE WHEN p.payment_method = 'cash' THEN o.total ELSE 0 END), 0) AS cash_revenue,
       COALESCE(SUM(CASE WHEN p.payment_method = 'qris' THEN o.total ELSE 0 END), 0) AS qris_revenue,
       COALESCE(SUM(CASE WHEN o.status = 'selesai' THEN 1 ELSE 0 END), 0) AS completed_today
     FROM orders o
     JOIN payments p ON p.order_id = o.id
     WHERE p.payment_status = 'verified'
       AND o.approved_at >= ? AND o.approved_at < ?`,
    [todayStart, todayEnd],
  );

  const statusCounts = await queryOne<{
    pending_count: number;
    completed_total: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN o.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
       COALESCE(SUM(CASE WHEN o.status = 'selesai' THEN 1 ELSE 0 END), 0) AS completed_total
     FROM orders o
     JOIN payments p ON p.order_id = o.id
     WHERE p.payment_status = 'verified' AND o.approved_at IS NOT NULL`,
  );

  // Build 7-day window in Jakarta dates.
  const sevenDaysAgoStart = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
  const seriesRows = await query<{
    day_key: string;
    total_sales: number;
    cash_revenue: number;
    qris_revenue: number;
    order_count: number;
  }>(
    `SELECT
       DATE_FORMAT(DATE_ADD(o.approved_at, INTERVAL 7 HOUR), '%Y-%m-%d') AS day_key,
       COALESCE(SUM(o.total), 0) AS total_sales,
       COALESCE(SUM(CASE WHEN p.payment_method = 'cash' THEN o.total ELSE 0 END), 0) AS cash_revenue,
       COALESCE(SUM(CASE WHEN p.payment_method = 'qris' THEN o.total ELSE 0 END), 0) AS qris_revenue,
       COUNT(o.id) AS order_count
     FROM orders o
     JOIN payments p ON p.order_id = o.id
     WHERE p.payment_status = 'verified'
       AND o.approved_at >= ? AND o.approved_at < ?
     GROUP BY day_key
     ORDER BY day_key ASC`,
    [sevenDaysAgoStart, todayEnd],
  );

  const seriesMap = new Map(seriesRows.map((r) => [r.day_key, r]));
  const salesChart: {
    date: string;
    total: number;
    cash: number;
    qris: number;
    count: number;
  }[] = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayStart.getTime() - i * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000);
    const key = jakartaDateKey(d);
    const found = seriesMap.get(key);
    salesChart.push({
      date: key,
      total: Number(found?.total_sales ?? 0),
      cash: Number(found?.cash_revenue ?? 0),
      qris: Number(found?.qris_revenue ?? 0),
      count: Number(found?.order_count ?? 0),
    });
  }

  const latestHeaders = await query<OrderHeaderRow>(
    `${ORDER_HEADER_SQL}
      WHERE p.payment_status = 'verified' AND o.approved_at IS NOT NULL
      ORDER BY o.approved_at DESC, o.id DESC
      LIMIT 8`,
  );
  const latestOrders = await attachItems(latestHeaders);

  const syncSummary = await queryOne<{
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

  const lastErrorRow = await queryOne<{ last_error: string | null }>(
    `SELECT last_error FROM sync_queue
      WHERE last_error IS NOT NULL AND sync_status IN ('pending', 'failed')
      ORDER BY updated_at DESC LIMIT 1`,
  );

  return {
    todayKey,
    todaySales: Number(todaySummary?.total_sales ?? 0),
    todayOrders: Number(todaySummary?.order_count ?? 0),
    cashRevenue: Number(todaySummary?.cash_revenue ?? 0),
    qrisRevenue: Number(todaySummary?.qris_revenue ?? 0),
    pendingOrders: Number(statusCounts?.pending_count ?? 0),
    completedOrdersToday: Number(todaySummary?.completed_today ?? 0),
    completedOrdersTotal: Number(statusCounts?.completed_total ?? 0),
    salesChart,
    latestOrders,
    sync: {
      configured: Boolean(process.env.GOOGLE_SHEETS_SPREADSHEET_ID),
      pending: Number(syncSummary?.pending_count ?? 0),
      synced: Number(syncSummary?.synced_count ?? 0),
      failed: Number(syncSummary?.failed_count ?? 0),
      lastSyncedAt: syncSummary?.last_synced_at ? syncSummary.last_synced_at.toISOString() : null,
      lastError: lastErrorRow?.last_error ?? null,
    },
  };
}

export async function getDailyReport(dateKey: string) {
  const { start, end } = dayRangeUtc(dateKey);

  const summary = await queryOne<{
    total_sales: number;
    total_transactions: number;
    cash_revenue: number;
    qris_revenue: number;
  }>(
    `SELECT
       COALESCE(SUM(o.total), 0) AS total_sales,
       COUNT(o.id) AS total_transactions,
       COALESCE(SUM(CASE WHEN p.payment_method = 'cash' THEN o.total ELSE 0 END), 0) AS cash_revenue,
       COALESCE(SUM(CASE WHEN p.payment_method = 'qris' THEN o.total ELSE 0 END), 0) AS qris_revenue
     FROM orders o
     JOIN payments p ON p.order_id = o.id
     WHERE p.payment_status = 'verified'
       AND o.approved_at >= ? AND o.approved_at < ?`,
    [start, end],
  );

  const headers = await query<OrderHeaderRow>(
    `${ORDER_HEADER_SQL}
      WHERE p.payment_status = 'verified'
        AND o.approved_at >= ? AND o.approved_at < ?
      ORDER BY o.approved_at DESC, o.id DESC`,
    [start, end],
  );
  const transactions = await attachItems(headers);

  return {
    date: dateKey,
    totalSales: Number(summary?.total_sales ?? 0),
    totalTransactions: Number(summary?.total_transactions ?? 0),
    cashRevenue: Number(summary?.cash_revenue ?? 0),
    qrisRevenue: Number(summary?.qris_revenue ?? 0),
    transactions,
  };
}

export async function getMonthlyReport(year: number, month: number) {
  const { start, end } = monthRangeUtc(year, month);

  const summary = await queryOne<{
    total_sales: number;
    total_transactions: number;
    cash_revenue: number;
    qris_revenue: number;
  }>(
    `SELECT
       COALESCE(SUM(o.total), 0) AS total_sales,
       COUNT(o.id) AS total_transactions,
       COALESCE(SUM(CASE WHEN p.payment_method = 'cash' THEN o.total ELSE 0 END), 0) AS cash_revenue,
       COALESCE(SUM(CASE WHEN p.payment_method = 'qris' THEN o.total ELSE 0 END), 0) AS qris_revenue
     FROM orders o
     JOIN payments p ON p.order_id = o.id
     WHERE p.payment_status = 'verified'
       AND o.approved_at >= ? AND o.approved_at < ?`,
    [start, end],
  );

  const dailyRows = await query<{
    day_key: string;
    total_sales: number;
    cash_revenue: number;
    qris_revenue: number;
    order_count: number;
  }>(
    `SELECT
       DATE_FORMAT(${jakartaDateSql("o.approved_at")}, '%Y-%m-%d') AS day_key,
       COALESCE(SUM(o.total), 0) AS total_sales,
       COALESCE(SUM(CASE WHEN p.payment_method = 'cash' THEN o.total ELSE 0 END), 0) AS cash_revenue,
       COALESCE(SUM(CASE WHEN p.payment_method = 'qris' THEN o.total ELSE 0 END), 0) AS qris_revenue,
       COUNT(o.id) AS order_count
     FROM orders o
     JOIN payments p ON p.order_id = o.id
     WHERE p.payment_status = 'verified'
       AND o.approved_at >= ? AND o.approved_at < ?
     GROUP BY day_key
     ORDER BY day_key ASC`,
    [start, end],
  );

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const byDay = new Map(dailyRows.map((r) => [r.day_key, r]));
  const dailySeries: {
    date: string;
    day: number;
    total: number;
    cash: number;
    qris: number;
    count: number;
  }[] = [];

  const ym = `${year}-${String(month).padStart(2, "0")}`;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${ym}-${String(d).padStart(2, "0")}`;
    const row = byDay.get(key);
    dailySeries.push({
      date: key,
      day: d,
      total: Number(row?.total_sales ?? 0),
      cash: Number(row?.cash_revenue ?? 0),
      qris: Number(row?.qris_revenue ?? 0),
      count: Number(row?.order_count ?? 0),
    });
  }

  const headers = await query<OrderHeaderRow>(
    `${ORDER_HEADER_SQL}
      WHERE p.payment_status = 'verified'
        AND o.approved_at >= ? AND o.approved_at < ?
      ORDER BY o.approved_at DESC, o.id DESC`,
    [start, end],
  );
  const transactions = await attachItems(headers);

  return {
    year,
    month,
    totalSales: Number(summary?.total_sales ?? 0),
    totalTransactions: Number(summary?.total_transactions ?? 0),
    cashRevenue: Number(summary?.cash_revenue ?? 0),
    qrisRevenue: Number(summary?.qris_revenue ?? 0),
    dailySeries,
    transactions,
  };
}
