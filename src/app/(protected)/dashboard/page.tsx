"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { formatDateLong, formatDateTime, paymentLabel, rupiah } from "@/lib/format";
import type { OrderView } from "@/lib/schemas";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface DashboardPayload {
  todayKey: string;
  todaySales: number;
  todayOrders: number;
  cashRevenue: number;
  qrisRevenue: number;
  pendingOrders: number;
  completedOrdersToday: number;
  completedOrdersTotal: number;
  salesChart: {
    date: string;
    total: number;
    cash: number;
    qris: number;
    count: number;
  }[];
  latestOrders: OrderView[];
  sync: {
    configured: boolean;
    pending: number;
    synced: number;
    failed: number;
    lastSyncedAt: string | null;
    lastError: string | null;
  };
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DashboardPayload;
      setData(json);
    } catch {
      setError("Gagal memuat ringkasan. Pastikan koneksi ke server aktif.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  async function handleManualSync() {
    setSyncingNow(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncMessage(body.error ?? "Sinkronisasi gagal dijalankan.");
      } else if (body.runResult?.skipped) {
        setSyncMessage(body.runResult.reason ?? "Sinkronisasi dilewati.");
      } else {
        setSyncMessage(
          `Sinkronisasi selesai: ${body.runResult?.succeeded ?? 0} berhasil, ${
            body.runResult?.failed ?? 0
          } gagal.`,
        );
      }
      await loadDashboard();
    } catch {
      setSyncMessage("Tidak dapat menghubungi server untuk sinkronisasi.");
    } finally {
      setSyncingNow(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold uppercase text-[#143656] leading-none">
            Ringkasan Kasir & Bar Hari Ini
          </h1>
          <p className="text-sm text-[#425264] mt-1">{formatDateLong(new Date())}</p>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={loadDashboard} className="btn-secondary text-sm">
            {loading ? "Memuat..." : "Segarkan Data"}
          </button>
          <Link href="/pos" className="btn-accent text-sm">
            + Buat Pesanan
          </Link>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-4 rounded bg-[#FBE9E7] border-2 border-[#941F14] text-[#941F14] text-sm font-bold"
        >
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="surface-card p-8 text-center text-[#143656] font-bold" role="status">
          Memuat rekap penjualan hari ini dari MySQL...
        </div>
      )}

      {data && (
        <>
          {/* Asymmetric Counter Ledger: Left Main Revenue Ticket + Right Live Queue Status */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <section
              aria-label="Omzet penjualan hari ini"
              className="lg:col-span-7 ticket-slip overflow-hidden"
            >
              <div className="px-5 py-3.5 bg-[#143656] text-[#FAF5EA] flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-xl font-extrabold uppercase leading-none">
                    Rekap Kas Hari Ini ({data.todayKey})
                  </h2>
                  <p className="text-xs text-[#F3EAD8]/80 mt-0.5">
                    Dihitung dari seluruh transaksi yang sudah diverifikasi kasir
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-sm bg-[#B3281B] text-white text-xs font-extrabold tabular-nums">
                  {data.todayOrders} Transaksi
                </span>
              </div>

              <div className="p-5 space-y-4">
                <div>
                  <span className="text-xs font-bold text-[#425264] block">
                    Total Omzet Hari Ini
                  </span>
                  <span className="text-3xl sm:text-4xl font-extrabold text-[#143656] tabular-nums mt-0.5 block">
                    {rupiah(data.todaySales)}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t-2 border-dashed border-[#143656]/40">
                  <div className="p-3.5 rounded bg-[#F3EAD8] border border-[#143656]">
                    <span className="text-xs font-bold text-[#425264] block">
                      Penerimaan Tunai (Cash)
                    </span>
                    <span className="text-xl font-extrabold tabular-nums text-[#143656] mt-0.5 block">
                      {rupiah(data.cashRevenue)}
                    </span>
                  </div>
                  <div className="p-3.5 rounded bg-[#F3EAD8] border border-[#143656]">
                    <span className="text-xs font-bold text-[#425264] block">
                      Penerimaan QRIS
                    </span>
                    <span className="text-xl font-extrabold tabular-nums text-[#B3281B] mt-0.5 block">
                      {rupiah(data.qrisRevenue)}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* Right: Barista Queue Status */}
            <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
              <div className="surface-card p-4 sm:p-5 flex items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-bold text-[#B3281B] block">
                    Order Pending (Sedang Diracik)
                  </span>
                  <span className="text-3xl font-extrabold text-[#143656] tabular-nums mt-1 block">
                    {data.pendingOrders}
                  </span>
                  <span className="text-xs text-[#425264]">
                    Pesanan sedang disiapkan & menunggu diserahkan
                  </span>
                </div>
                <Link href="/orders/pending" className="btn-primary text-xs shrink-0">
                  Buka Antrean
                </Link>
              </div>

              <div className="surface-card p-4 sm:p-5 flex items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-bold text-[#175E38] block">
                    Order Selesai Hari Ini
                  </span>
                  <span className="text-3xl font-extrabold text-[#143656] tabular-nums mt-1 block">
                    {data.completedOrdersToday}
                  </span>
                  <span className="text-xs text-[#425264] tabular-nums">
                    Total riwayat selesai: {data.completedOrdersTotal} pesanan
                  </span>
                </div>
                <Link href="/orders/completed" className="btn-secondary text-xs shrink-0">
                  Lihat Riwayat
                </Link>
              </div>
            </div>
          </div>

          {/* Middle row: Question-driven 7-Day Chart + Google Sheets Sync Status */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <section
              aria-label="Grafik penjualan 7 hari terakhir"
              className="lg:col-span-8 surface-card p-5"
            >
              <div className="pb-3 mb-4 border-b border-[#C8BBA2]">
                <h2 className="font-display text-2xl font-extrabold uppercase text-[#143656] leading-none">
                  Bagaimana perbandingan omzet Tunai vs QRIS dalam 7 hari terakhir?
                </h2>
                <p className="text-xs text-[#425264] mt-1">
                  Rekap harian dalam Rupiah berdasarkan metode pembayaran terverifikasi (WIB)
                </p>
              </div>

              <div className="h-64 w-full">
                <Bar
                  data={{
                    labels: data.salesChart.map((d) => d.date.slice(5)),
                    datasets: [
                      {
                        label: "Tunai (Cash)",
                        data: data.salesChart.map((d) => d.cash),
                        backgroundColor: "#143656",
                        borderRadius: 3,
                      },
                      {
                        label: "QRIS",
                        data: data.salesChart.map((d) => d.qris),
                        backgroundColor: "#B3281B",
                        borderRadius: 3,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: {
                        position: "top",
                        labels: { color: "#1A1917", font: { weight: "bold" } },
                      },
                    },
                    scales: {
                      x: {
                        ticks: { color: "#425264" },
                        grid: { display: false },
                      },
                      y: {
                        ticks: {
                          color: "#425264",
                          callback: (v) => `Rp ${Number(v).toLocaleString("id-ID")}`,
                        },
                      },
                    },
                  }}
                />
              </div>
            </section>

            {/* Google Sheets Synchronization Card */}
            <section
              aria-label="Status sinkronisasi Google Sheets"
              className="lg:col-span-4 surface-card p-5 space-y-4"
            >
              <div className="pb-3 border-b border-[#C8BBA2]">
                <h2 className="font-display text-2xl font-extrabold uppercase text-[#143656] leading-none">
                  Sinkronisasi Google Sheets
                </h2>
                <p className="text-xs text-[#425264] mt-1">
                  Cadangan otomatis ke 4 tab spreadsheet saat internet stabil
                </p>
              </div>

              <div className="space-y-2.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[#425264] font-semibold">Service Account</span>
                  <span
                    className={`px-2 py-0.5 rounded-sm text-xs font-bold ${
                      data.sync.configured
                        ? "bg-[#E5F3EB] text-[#175E38]"
                        : "bg-[#EAE0C8] text-[#143656]"
                    }`}
                  >
                    {data.sync.configured ? "Aktif" : "Mode Lokal Saja"}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                  <div className="p-2.5 rounded bg-[#F3EAD8] border border-[#143656]">
                    <span className="text-xs font-bold text-[#425264] block">Antrean</span>
                    <span className="text-lg font-extrabold tabular-nums text-[#143656]">
                      {data.sync.pending}
                    </span>
                  </div>
                  <div className="p-2.5 rounded bg-[#E5F3EB] border border-[#175E38]">
                    <span className="text-xs font-bold text-[#175E38] block">Terkirim</span>
                    <span className="text-lg font-extrabold tabular-nums text-[#175E38]">
                      {data.sync.synced}
                    </span>
                  </div>
                  <div className="p-2.5 rounded bg-[#FBE9E7] border border-[#941F14]">
                    <span className="text-xs font-bold text-[#941F14] block">Tertunda</span>
                    <span className="text-lg font-extrabold tabular-nums text-[#941F14]">
                      {data.sync.failed}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-[#425264] pt-1">
                  Kiriman terakhir:{" "}
                  <strong className="tabular-nums text-[#1A1917]">
                    {data.sync.lastSyncedAt ? formatDateTime(data.sync.lastSyncedAt) : "Belum ada"}
                  </strong>
                </p>

                {data.sync.lastError && (
                  <p className="p-2.5 rounded bg-[#FBE9E7] border border-[#941F14] text-xs text-[#941F14] break-words">
                    <strong>Catatan:</strong> {data.sync.lastError}
                  </p>
                )}

                {syncMessage && (
                  <p
                    role="status"
                    className="p-2.5 rounded bg-[#F3EAD8] border border-[#143656] text-xs font-bold text-[#143656]"
                  >
                    {syncMessage}
                  </p>
                )}
              </div>

              <button
                type="button"
                disabled={syncingNow}
                onClick={handleManualSync}
                className="btn-primary w-full text-sm"
              >
                {syncingNow ? "Menyinkronkan..." : "Sinkronkan Sekarang"}
              </button>
            </section>
          </div>

          {/* Latest Transactions */}
          <section aria-label="Transaksi terbaru" className="surface-card overflow-hidden">
            <div className="px-5 py-3.5 bg-[#143656] text-[#FAF5EA] flex items-center justify-between">
              <div>
                <h2 className="font-display text-xl font-extrabold uppercase leading-none">
                  8 Transaksi Terakhir
                </h2>
                <p className="text-xs text-[#F3EAD8]/80 mt-0.5">
                  Pesanan terbaru yang telah melewati verifikasi pembayaran kasir
                </p>
              </div>
              <Link
                href="/orders/pending"
                className="text-xs font-bold text-[#FAF5EA] underline hover:text-white"
              >
                Buka Order Pending
              </Link>
            </div>

            {data.latestOrders.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-bold text-[#143656]">Belum ada transaksi tercatat.</p>
                <p className="text-xs text-[#425264] mt-1">
                  Buat pesanan pertama di halaman Kasir POS untuk mulai mencatat penjualan.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-[#143656] bg-[#F3EAD8] text-xs font-bold text-[#143656]">
                      <th className="py-3 px-4">Kode Order</th>
                      <th className="py-3 px-3">Pesanan Minuman</th>
                      <th className="py-3 px-3">Pelanggan</th>
                      <th className="py-3 px-3">Pembayaran</th>
                      <th className="py-3 px-3">Status Bar</th>
                      <th className="py-3 px-3">Waktu Pesan</th>
                      <th className="py-3 px-4 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#C8BBA2]">
                    {data.latestOrders.map((o) => (
                      <tr key={o.clientUuid} className="hover:bg-[#F3EAD8]/50">
                        <td className="py-3 px-4 font-extrabold tabular-nums text-[#143656]">
                          {o.orderCode}
                        </td>
                        <td className="py-3 px-3 text-xs font-semibold text-[#1A1917]">
                          {o.items.map((i) => `${i.quantity}x ${i.productName}`).join(", ")}
                        </td>
                        <td className="py-3 px-3 font-medium">{o.customerName || "Umum"}</td>
                        <td className="py-3 px-3 font-bold text-[#143656]">
                          {paymentLabel(o.payment.method)}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-sm text-xs font-bold ${
                              o.status === "selesai"
                                ? "bg-[#E5F3EB] text-[#175E38]"
                                : "bg-[#B3281B] text-white"
                            }`}
                          >
                            {o.status === "selesai" ? "Order Selesai" : "Order Pending"}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-xs text-[#425264] tabular-nums whitespace-nowrap">
                          {formatDateTime(o.approvedAt)}
                        </td>
                        <td className="py-3 px-4 text-right font-extrabold tabular-nums text-[#B3281B]">
                          {rupiah(o.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
