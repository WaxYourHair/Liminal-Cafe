"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDateTime, formatTime, jakartaDateKey, paymentLabel, rupiah } from "@/lib/format";
import { mergeWithLocalOrders, submitOrderCompletion } from "@/lib/offline";
import type { OrderView } from "@/lib/schemas";

export default function OrdersBoard({ mode }: { mode: "pending" | "selesai" }) {
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<string>(mode === "selesai" ? jakartaDateKey() : "");

  const [detailOrder, setDetailOrder] = useState<OrderView | null>(null);
  const [confirmCompleteOrder, setConfirmCompleteOrder] = useState<OrderView | null>(null);
  const [completing, setCompleting] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("status", mode);
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    if (mode === "selesai" && dateFilter) params.set("date", dateFilter);

    try {
      const res = await fetch(`/api/orders?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { orders: OrderView[] };
      const merged = await mergeWithLocalOrders(data.orders, {
        status: mode,
        q: searchQuery.trim() || undefined,
        dateKey: mode === "selesai" && dateFilter ? dateFilter : undefined,
      });
      setOrders(merged);
    } catch {
      const merged = await mergeWithLocalOrders([], {
        status: mode,
        q: searchQuery.trim() || undefined,
        dateKey: mode === "selesai" && dateFilter ? dateFilter : undefined,
      });
      setOrders(merged);
      if (merged.length === 0) {
        setError("Tidak dapat memuat daftar pesanan dari server (Mode Offline).");
      }
    } finally {
      setLoading(false);
    }
  }, [mode, searchQuery, dateFilter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    const onOutboxChange = () => fetchOrders();
    window.addEventListener("liminal-outbox-change", onOutboxChange);
    return () => window.removeEventListener("liminal-outbox-change", onOutboxChange);
  }, [fetchOrders]);

  async function handleConfirmSelesai() {
    if (!confirmCompleteOrder) return;
    setCompleting(true);
    setError(null);
    try {
      const target = confirmCompleteOrder;
      const res = await submitOrderCompletion(target);
      setConfirmCompleteOrder(null);
      setDetailOrder(null);
      setBannerMessage(
        res.synced
          ? `Pesanan ${target.orderCode} telah diserahkan ke pelanggan dan dipindahkan ke Order Selesai.`
          : `Pesanan ${target.orderCode} ditandai Order Selesai di tablet dan akan disinkronkan saat online.`,
      );
      await fetchOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyelesaikan pesanan.");
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header & Strictly 2 Order Management Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold uppercase text-[#143656] leading-none">
            {mode === "pending" ? "Order Pending (Antrean Bar)" : "Order Selesai"}
          </h1>
          <p className="text-sm text-[#425264] mt-1">
            {mode === "pending"
              ? "Pesanan yang sudah diverifikasi pembayarannya dan sedang diracik untuk pelanggan."
              : "Riwayat pesanan yang sudah selesai disiapkan dan diserahkan kepada pelanggan."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <nav
            aria-label="Tab manajemen pesanan"
            className="inline-flex bg-[#143656] p-1 rounded border-2 border-[#0E2740] gap-1"
          >
            <Link
              href="/orders/pending"
              aria-current={mode === "pending" ? "page" : undefined}
              className={`inline-flex items-center justify-center min-h-[40px] px-4 py-1.5 rounded-sm text-sm font-bold transition-colors ${
                mode === "pending"
                  ? "bg-[#B3281B] text-white"
                  : "text-[#FAF5EA] hover:bg-[#1C466E]"
              }`}
            >
              Order Pending
            </Link>
            <Link
              href="/orders/completed"
              aria-current={mode === "selesai" ? "page" : undefined}
              className={`inline-flex items-center justify-center min-h-[40px] px-4 py-1.5 rounded-sm text-sm font-bold transition-colors ${
                mode === "selesai"
                  ? "bg-[#B3281B] text-white"
                  : "text-[#FAF5EA] hover:bg-[#1C466E]"
              }`}
            >
              Order Selesai
            </Link>
          </nav>

          <button type="button" onClick={fetchOrders} className="btn-secondary text-sm">
            {loading ? "Memuat..." : "Segarkan"}
          </button>
        </div>
      </div>

      {bannerMessage && (
        <div
          role="status"
          className="p-4 rounded bg-[#E5F3EB] border-2 border-[#175E38] text-[#175E38] flex items-center justify-between gap-3 text-sm font-bold"
        >
          <span>{bannerMessage}</span>
          <button
            type="button"
            onClick={() => setBannerMessage(null)}
            className="text-xs underline font-extrabold px-2 py-1"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Search & Date Filter Bar */}
      <div className="surface-card p-3.5 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
        <div className={mode === "selesai" ? "sm:col-span-7" : "sm:col-span-12"}>
          <label
            htmlFor="order-search-input"
            className="block text-xs font-bold text-[#143656] mb-1"
          >
            Cari Kode Order atau Nama Pelanggan
          </label>
          <input
            id="order-search-input"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Ketik kode order (mis. LC-2026...) atau nama pelanggan..."
            className="field-input text-sm"
          />
        </div>

        {mode === "selesai" && (
          <div className="sm:col-span-5 flex items-end gap-2">
            <div className="flex-1">
              <label
                htmlFor="order-date-filter"
                className="block text-xs font-bold text-[#143656] mb-1"
              >
                Tanggal Selesai
              </label>
              <input
                id="order-date-filter"
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="field-input tabular-nums text-sm"
              />
            </div>
            {dateFilter && (
              <button
                type="button"
                onClick={() => setDateFilter("")}
                className="btn-secondary text-xs px-3"
              >
                Semua Tanggal
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="p-4 rounded bg-[#FBE9E7] border-2 border-[#941F14] text-[#941F14] text-sm font-bold"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="surface-card p-8 text-center text-[#143656] font-bold" role="status">
          Memuat slip pesanan...
        </div>
      ) : orders.length === 0 ? (
        <div className="surface-card p-10 text-center space-y-2">
          <p className="text-base font-bold text-[#143656]">
            {mode === "pending"
              ? "Tidak ada antrean Order Pending saat ini."
              : "Belum ada data Order Selesai pada tanggal ini."}
          </p>
          <p className="text-sm text-[#425264]">
            {mode === "pending"
              ? "Pesanan baru yang sudah diverifikasi pembayarannya akan langsung tampil sebagai slip bar di sini."
              : "Pesanan yang telah ditandai Order Selesai akan tercatat di halaman ini."}
          </p>
          {mode === "pending" && (
            <div className="pt-2">
              <Link href="/pos" className="btn-accent">
                + Buat Pesanan Baru
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {orders.map((order) => (
            <article
              key={order.clientUuid}
              className="ticket-slip flex flex-col justify-between overflow-hidden"
            >
              <div>
                {/* Barista Ticket Navy Header */}
                <div className="px-4 py-3 bg-[#143656] text-[#FAF5EA] flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-extrabold text-white tabular-nums">
                        {order.orderCode}
                      </span>
                      {order.localOnly && (
                        <span className="px-2 py-0.5 rounded-sm text-[11px] font-bold bg-[#B3281B] text-white">
                          Lokal Tablet
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-semibold text-[#F3EAD8]/90 mt-0.5">
                      Pelanggan: <strong className="text-white">{order.customerName || "Umum"}</strong>
                    </p>
                  </div>

                  <div className="text-right">
                    <span className="inline-block px-2 py-0.5 rounded-sm text-[11px] font-bold bg-[#E5F3EB] text-[#175E38]">
                      {paymentLabel(order.payment.method)} Lunas
                    </span>
                    <p className="text-[11px] text-[#F3EAD8]/85 mt-1 tabular-nums">
                      {mode === "pending"
                        ? `Masuk: ${formatTime(order.approvedAt)}`
                        : formatDateTime(order.completedAt ?? order.approvedAt)}
                    </p>
                  </div>
                </div>

                {/* Ordered Drink List */}
                <div className="p-4 space-y-3">
                  <ul className="divide-y divide-[#C8BBA2] text-sm">
                    {order.items.map((item, idx) => (
                      <li key={idx} className="py-2 first:pt-0 last:pb-0 flex items-start justify-between gap-2">
                        <div>
                          <span className="inline-block min-w-[26px] font-extrabold tabular-nums text-[#B3281B]">
                            {item.quantity}x
                          </span>{" "}
                          <span className="font-bold text-[#1A1917]">{item.productName}</span>
                          {item.notes && (
                            <p className="text-xs text-[#425264] font-semibold mt-0.5">
                              Catatan: {item.notes}
                            </p>
                          )}
                        </div>
                        <span className="text-xs font-bold text-[#425264] tabular-nums shrink-0">
                          {rupiah(item.subtotal)}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {order.notes && (
                    <p className="p-2.5 rounded-sm bg-[#F3EAD8] border border-[#143656]/40 text-xs text-[#1A1917]">
                      <strong>Catatan Pesanan:</strong> {order.notes}
                    </p>
                  )}
                </div>
              </div>

              {/* Perforated Ticket Footer */}
              <div className="px-4 py-3 bg-[#F3EAD8]/70 border-t-2 border-dashed border-[#143656]/45 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#425264]">
                    Kasir: {order.payment.verifiedByName ?? order.cashierName}
                  </span>
                  <div className="text-right">
                    <span className="text-xs font-bold text-[#425264] mr-2">Total</span>
                    <span className="text-lg font-extrabold text-[#143656] tabular-nums">
                      {rupiah(order.total)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDetailOrder(order)}
                    className="btn-secondary flex-1 text-xs sm:text-sm py-2"
                  >
                    Rincian Slip
                  </button>

                  {mode === "pending" && (
                    <button
                      type="button"
                      onClick={() => setConfirmCompleteOrder(order)}
                      className="btn-accent flex-1 text-xs sm:text-sm py-2"
                    >
                      Order Selesai
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Order Detail Modal */}
      {detailOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setDetailOrder(null)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="detail-order-title"
            className="relative z-10 w-full max-w-lg modal-elevated max-h-[90dvh] overflow-y-auto"
          >
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 bg-[#143656] text-[#FAF5EA] border-b-2 border-[#0E2740]">
              <div>
                <p className="text-xs font-bold text-[#F3EAD8]/80">Slip Transaksi</p>
                <h2
                  id="detail-order-title"
                  className="text-xl font-extrabold text-white tabular-nums"
                >
                  {detailOrder.orderCode}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDetailOrder(null)}
                aria-label="Tutup rincian pesanan"
                className="min-w-[44px] min-h-[40px] px-3 rounded bg-[#0E2740] text-white text-xs font-bold border border-[#FAF5EA]/30"
              >
                Tutup
              </button>
            </div>

            <div className="p-5 space-y-4">
              <dl className="grid grid-cols-2 gap-2.5 text-sm bg-[#F3EAD8] p-3.5 rounded border border-[#143656]">
                <div>
                  <dt className="text-xs text-[#425264]">Pelanggan</dt>
                  <dd className="font-bold text-[#1A1917]">{detailOrder.customerName || "Umum"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#425264]">Status Pesanan</dt>
                  <dd className="font-bold text-[#143656]">
                    {detailOrder.status === "pending" ? "Order Pending" : "Order Selesai"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#425264]">Waktu Pesan</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatDateTime(detailOrder.approvedAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#425264]">Waktu Selesai</dt>
                  <dd className="font-semibold tabular-nums">
                    {detailOrder.completedAt ? formatDateTime(detailOrder.completedAt) : "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#425264]">Metode Pembayaran</dt>
                  <dd className="font-bold">
                    {paymentLabel(detailOrder.payment.method)} ({detailOrder.payment.status})
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#425264]">Diverifikasi Oleh</dt>
                  <dd className="font-semibold">
                    {detailOrder.payment.verifiedByName ?? detailOrder.cashierName}
                  </dd>
                </div>
              </dl>

              <div>
                <h3 className="text-xs font-bold text-[#143656] mb-2">Daftar Minuman Dipesan</h3>
                <ul className="divide-y divide-[#C8BBA2] border border-[#143656] rounded bg-white px-3">
                  {detailOrder.items.map((it, idx) => (
                    <li key={idx} className="py-2.5 flex items-start justify-between gap-2 text-sm">
                      <div>
                        <p className="font-bold text-[#1A1917]">
                          <span className="tabular-nums text-[#B3281B]">{it.quantity}x</span>{" "}
                          {it.productName}
                        </p>
                        <p className="text-xs text-[#425264] tabular-nums">@ {rupiah(it.price)}</p>
                        {it.notes && (
                          <p className="text-xs text-[#425264] font-semibold mt-0.5">
                            Catatan: {it.notes}
                          </p>
                        )}
                      </div>
                      <span className="font-bold tabular-nums text-[#143656]">
                        {rupiah(it.subtotal)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {detailOrder.notes && (
                <p className="text-sm p-3 rounded bg-[#F3EAD8] border border-[#143656]">
                  <strong>Catatan Pesanan:</strong> {detailOrder.notes}
                </p>
              )}

              <div className="pt-3 border-t-2 border-dashed border-[#143656]/50 space-y-1 text-sm">
                <div className="flex justify-between font-extrabold text-base text-[#143656]">
                  <span>Total Tagihan</span>
                  <span className="tabular-nums text-[#B3281B]">{rupiah(detailOrder.total)}</span>
                </div>
                {detailOrder.payment.method === "cash" && (
                  <>
                    <div className="flex justify-between text-[#425264]">
                      <span>Tunai Diterima</span>
                      <span className="tabular-nums">{rupiah(detailOrder.payment.paidAmount)}</span>
                    </div>
                    <div className="flex justify-between text-[#425264]">
                      <span>Kembalian</span>
                      <span className="tabular-nums">
                        {rupiah(detailOrder.payment.changeAmount)}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#C8BBA2]">
                <button
                  type="button"
                  onClick={() => setDetailOrder(null)}
                  className="btn-secondary"
                >
                  Tutup
                </button>
                {detailOrder.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => setConfirmCompleteOrder(detailOrder)}
                    className="btn-accent"
                  >
                    Order Selesai
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog before completing an order */}
      {confirmCompleteOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => !completing && setConfirmCompleteOrder(null)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-complete-title"
            className="relative z-10 w-full max-w-md modal-elevated p-5 sm:p-6 space-y-4"
          >
            <h2
              id="confirm-complete-title"
              className="font-display text-2xl font-extrabold uppercase text-[#143656]"
            >
              Konfirmasi Order Selesai
            </h2>
            <p className="text-sm text-[#1A1917]">
              Apakah pesanan{" "}
              <strong className="tabular-nums">{confirmCompleteOrder.orderCode}</strong> untuk{" "}
              <strong>{confirmCompleteOrder.customerName || "Pelanggan Umum"}</strong> sudah selesai
              diracik dan diserahkan kepada pelanggan?
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={completing}
                onClick={() => setConfirmCompleteOrder(null)}
                className="btn-secondary"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={completing}
                onClick={handleConfirmSelesai}
                className="btn-accent"
              >
                {completing ? "Memproses..." : "Order Selesai"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
