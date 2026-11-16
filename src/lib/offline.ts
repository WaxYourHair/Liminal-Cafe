"use client";

import { openDB, type IDBPDatabase } from "idb";
import { jakartaDateKey } from "./format";
import type { CreateOrderOp, OrderView, PushOp, PushResult } from "./schemas";

export interface CatalogSnapshot {
  user: { id: number; name: string; username: string; role: "admin" | "kasir" };
  cafeName: string;
  qris: { present: boolean; url: string };
  categories: { id: number; name: string; description: string | null; sort_order: number; product_count: number }[];
  products: {
    id: number;
    category_id: number;
    category_name: string;
    name: string;
    description: string | null;
    price: number;
    image: string | null;
    is_active: number;
  }[];
  nextSequence: number;
  savedAt: string;
}

interface OutboxRecord {
  id: string; // `${clientUuid}:${type}`
  createdAt: number;
  op: PushOp;
}

const DB_NAME = "liminal_pos_idb";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (typeof window === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("kv")) {
          db.createObjectStore("kv");
        }
        if (!db.objectStoreNames.contains("outbox")) {
          const store = db.createObjectStore("outbox", { keyPath: "id" });
          store.createIndex("by_created", "createdAt");
        }
        if (!db.objectStoreNames.contains("local_orders")) {
          db.createObjectStore("local_orders", { keyPath: "clientUuid" });
        }
      },
    });
  }
  return dbPromise;
}

function getDeviceCode(): string {
  if (typeof window === "undefined") return "TB";
  const existing = window.localStorage.getItem("liminal_device_code");
  if (existing && /^[A-Z0-9]{2}$/.test(existing)) return existing;
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code =
    chars[Math.floor(Math.random() * chars.length)] +
    chars[Math.floor(Math.random() * chars.length)];
  window.localStorage.setItem("liminal_device_code", code);
  return code;
}

export function allocateOrderCode(serverNextSeq?: number): string {
  const dateCompact = jakartaDateKey().replace(/-/g, "").slice(2); // YYMMDD
  const device = getDeviceCode();
  const storageKey = `liminal_seq_${dateCompact}`;
  let current = 0;
  if (typeof window !== "undefined") {
    current = Number.parseInt(window.localStorage.getItem(storageKey) ?? "0", 10) || 0;
  }
  const base = Math.max(current + 1, serverNextSeq ?? 1);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(storageKey, String(base));
  }
  return `${dateCompact}-${device}-${String(base).padStart(3, "0")}`;
}

export async function loadCatalogWithCache(): Promise<{
  snapshot: CatalogSnapshot;
  fromCache: boolean;
}> {
  const db = getDb();
  try {
    const res = await fetch("/api/catalog", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Omit<CatalogSnapshot, "savedAt">;
    const snapshot: CatalogSnapshot = { ...data, savedAt: new Date().toISOString() };
    if (db) {
      const conn = await db;
      await conn.put("kv", snapshot, "catalog_snapshot");
    }
    return { snapshot, fromCache: false };
  } catch (err) {
    if (db) {
      const conn = await db;
      const cached = (await conn.get("kv", "catalog_snapshot")) as CatalogSnapshot | undefined;
      if (cached) {
        return { snapshot: cached, fromCache: true };
      }
    }
    throw err;
  }
}

export async function getOutboxCount(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const conn = await db;
  return conn.count("outbox");
}

export async function submitApprovedOrder(
  op: CreateOrderOp,
  cashierName: string,
): Promise<{ synced: boolean; orderCode: string }> {
  const total = op.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const paidAmount = op.payment.method === "qris" ? total : op.payment.paidAmount;
  const changeAmount = op.payment.method === "cash" ? paidAmount - total : 0;

  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(op),
    });
    if (res.ok) {
      const data = (await res.json()) as { orderId: number; orderCode: string };
      return { synced: true, orderCode: data.orderCode };
    }
    if (res.status >= 400 && res.status < 500) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error ?? "Data pesanan tidak valid.");
    }
  } catch (err) {
    if (err instanceof Error && !err.message.match(/fetch|network|Failed|load/i)) {
      throw err;
    }
  }

  // Network unreachable: store in IndexedDB outbox + local orders so tablet keeps working.
  const db = getDb();
  if (!db) throw new Error("Penyimpanan lokal tidak tersedia.");
  const conn = await db;

  const localOrder: OrderView = {
    id: null,
    clientUuid: op.clientUuid,
    orderCode: op.orderCode,
    customerName: op.customerName,
    notes: op.notes,
    status: "pending",
    total,
    approvedAt: op.approvedAt,
    completedAt: null,
    cashierName,
    payment: {
      method: op.payment.method,
      status: "verified",
      paidAmount,
      changeAmount,
      verifiedByName: cashierName,
      paidAt: op.approvedAt,
    },
    items: op.items.map((it) => ({
      productName: it.productName,
      price: it.price,
      quantity: it.quantity,
      subtotal: it.price * it.quantity,
      notes: it.notes,
    })),
    localOnly: true,
  };

  const record: OutboxRecord = {
    id: `${op.clientUuid}:create`,
    createdAt: Date.now(),
    op,
  };

  await conn.put("local_orders", localOrder);
  await conn.put("outbox", record);
  window.dispatchEvent(new CustomEvent("liminal-outbox-change"));
  return { synced: false, orderCode: op.orderCode };
}

export async function submitOrderCompletion(
  order: OrderView,
): Promise<{ synced: boolean }> {
  const completedAt = new Date().toISOString();

  if (!order.localOnly) {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(order.clientUuid)}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completedAt }),
      });
      if (res.ok) {
        const db = getDb();
        if (db) {
          const conn = await db;
          await conn.delete("local_orders", order.clientUuid);
        }
        return { synced: true };
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 404) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? "Gagal menyelesaikan pesanan.");
      }
    } catch (err) {
      if (err instanceof Error && !err.message.match(/fetch|network|Failed|load/i)) {
        throw err;
      }
    }
  }

  const db = getDb();
  if (!db) throw new Error("Penyimpanan lokal tidak tersedia.");
  const conn = await db;

  const updatedLocal: OrderView = {
    ...order,
    status: "selesai",
    completedAt,
    localOnly: true,
  };

  await conn.put("local_orders", updatedLocal);
  await conn.put("outbox", {
    id: `${order.clientUuid}:complete`,
    createdAt: Date.now() + 1,
    op: {
      type: "complete",
      clientUuid: order.clientUuid,
      completedAt,
    },
  } satisfies OutboxRecord);

  window.dispatchEvent(new CustomEvent("liminal-outbox-change"));
  return { synced: false };
}

export async function mergeWithLocalOrders(
  serverOrders: OrderView[],
  filter: { status: "pending" | "selesai"; q?: string; dateKey?: string },
): Promise<OrderView[]> {
  const db = getDb();
  if (!db) return serverOrders;
  const conn = await db;
  const localAll = (await conn.getAll("local_orders")) as OrderView[];
  if (localAll.length === 0) return serverOrders;

  const byUuid = new Map<string, OrderView>();
  for (const srv of serverOrders) {
    byUuid.set(srv.clientUuid, srv);
  }
  for (const loc of localAll) {
    const existing = byUuid.get(loc.clientUuid);
    if (!existing) {
      byUuid.set(loc.clientUuid, loc);
    } else if (loc.status === "selesai" && existing.status === "pending") {
      byUuid.set(loc.clientUuid, { ...existing, status: "selesai", completedAt: loc.completedAt, localOnly: true });
    }
  }

  let merged = Array.from(byUuid.values()).filter((o) => o.status === filter.status);
  if (filter.q) {
    const needle = filter.q.toLowerCase();
    merged = merged.filter(
      (o) =>
        o.orderCode.toLowerCase().includes(needle) ||
        (o.customerName ?? "").toLowerCase().includes(needle),
    );
  }
  if (filter.dateKey) {
    merged = merged.filter((o) => {
      const ref = o.status === "selesai" ? (o.completedAt ?? o.approvedAt) : o.approvedAt;
      return jakartaDateKey(ref) === filter.dateKey;
    });
  }

  merged.sort((a, b) => {
    if (filter.status === "pending") {
      return new Date(a.approvedAt).getTime() - new Date(b.approvedAt).getTime();
    }
    const ta = new Date(a.completedAt ?? a.approvedAt).getTime();
    const tb = new Date(b.completedAt ?? b.approvedAt).getTime();
    return tb - ta;
  });

  return merged;
}

let flushing = false;

export async function flushOfflineOutbox(): Promise<{ flushed: number; remaining: number }> {
  if (flushing || typeof window === "undefined") {
    return { flushed: 0, remaining: await getOutboxCount() };
  }
  const db = getDb();
  if (!db) return { flushed: 0, remaining: 0 };

  flushing = true;
  try {
    const conn = await db;
    const records = (await conn.getAllFromIndex("outbox", "by_created")) as OutboxRecord[];
    if (records.length === 0) return { flushed: 0, remaining: 0 };

    const res = await fetch("/api/orders/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ops: records.map((r) => r.op) }),
    });
    if (!res.ok) {
      return { flushed: 0, remaining: records.length };
    }
    const { results } = (await res.json()) as { results: PushResult[] };
    let flushed = 0;

    for (const r of results) {
      if (r.ok) {
        await conn.delete("outbox", `${r.clientUuid}:${r.type}`);
        flushed += 1;
      }
    }

    const remainingRecords = (await conn.getAll("outbox")) as OutboxRecord[];
    const pendingUuids = new Set(remainingRecords.map((rec) => rec.op.clientUuid));
    const localOrders = (await conn.getAll("local_orders")) as OrderView[];
    for (const loc of localOrders) {
      if (!pendingUuids.has(loc.clientUuid)) {
        await conn.delete("local_orders", loc.clientUuid);
      }
    }

    window.dispatchEvent(new CustomEvent("liminal-outbox-change"));
    return { flushed, remaining: remainingRecords.length };
  } catch {
    return { flushed: 0, remaining: await getOutboxCount() };
  } finally {
    flushing = false;
  }
}
