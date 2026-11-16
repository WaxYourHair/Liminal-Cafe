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
import { formatDateTime, jakartaDateKey, MONTHS_ID, paymentLabel, rupiah } from "@/lib/format";
import type { OrderView } from "@/lib/schemas";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface DailyPayload {
  date: string;
  totalSales: number;
  totalTransactions: number;
  cashRevenue: number;
  qrisRevenue: number;
  transactions: OrderView[];
}

interface MonthlyPayload {
  year: number;
  month: number;
  totalSales: number;
  totalTransactions: number;
  cashRevenue: number;
  qrisRevenue: number;
  dailySeries: {
    date: string;
    day: number;
    total: number;
    cash: number;
    qris: number;
    count: number;
  }[];
  transactions: OrderView[];
}

export default function ReportsView({
  initialTab = "daily",
}: {
  initialTab?: "daily" | "monthly";
}) {
  const [tab, setTab] = useState<"daily" | "monthly">(initialTab);
  const today = jakartaDateKey();
  const [initYear, initMonth] = today.split("-").map(Number);

  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedYear, setSelectedYear] = useState(initYear);
  const [selectedMonth, setSelectedMonth] = useState(initMonth);

  const [dailyData, setDailyData] = useState<DailyPayload | null>(null);
  const [monthlyData, setMonthlyData] = useState<MonthlyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === "daily") {
        const res = await fetch(`/api/reports/daily?date=${encodeURIComponent(selectedDate)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as DailyPayload;
        setDailyData(json);
      } else {
        const res = await fetch(
          `/api/reports/monthly?year=${selectedYear}&month=${selectedMonth}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as MonthlyPayload;
        setMonthlyData(json);
      }
    } catch {
      setError("Gagal memuat laporan penjualan dari database.");
    } finally {
      setLoading(false);
    }
  }, [tab, selectedDate, selectedYear, selectedMonth]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold uppercase text-[#143656] leading-none">
            Laporan Penjualan Kasir
          </h1>
          <p className="text-sm text-[#425264] mt-1">
            Rekapitulasi penjualan dari seluruh pesanan yang masuk.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <nav
            aria-label="Jenis laporan penjualan"
            className="inline-flex bg-[#143656] p-1 rounded border-2 border-[#0E2740] gap-1"
          >
            <Link
              href="/reports/daily"
              onClick={(e) => {
                e.preventDefault();
                setTab("daily");
              }}
              aria-current={tab === "daily" ? "page" : undefined}
              className={`min-h-[40px] px-4 py-1.5 rounded-sm text-sm font-bold flex items-center ${
                tab === "daily"
                  ? "bg-[#B3281B] text-white"
                  : "text-[#FAF5EA] hover:bg-[#1C466E]"
              }`}
            >
              Laporan Harian
            </Link>
            <Link
              href="/reports/monthly"
              onClick={(e) => {
                e.preventDefault();
                setTab("monthly");
              }}
              aria-current={tab === "monthly" ? "page" : undefined}
              className={`min-h-[40px] px-4 py-1.5 rounded-sm text-sm font-bold flex items-center ${
                tab === "monthly"
                  ? "bg-[#B3281B] text-white"
                  : "text-[#FAF5EA] hover:bg-[#1C466E]"
              }`}
            >
              Laporan Bulanan
            </Link>
          </nav>

          <button type="button" onClick={loadReport} className="btn-secondary text-sm">
            {loading ? "Memuat..." : "Segarkan"}
          </button>
        </div>
      </div>

      {/* Filter Controls */}
      <div className="surface-card p-3.5">
        {tab === "daily" ? (
          <div className="max-w-xs">
            <label
              htmlFor="daily-report-date"
              className="block text-xs font-bold text-[#143656] mb-1"
            >
              Pilih Tanggal Laporan Harian
            </label>
            <input
              id="daily-report-date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="field-input tabular-nums text-sm"
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 max-w-md gap-3">
            <div>
              <label
                htmlFor="monthly-report-month"
                className="block text-xs font-bold text-[#143656] mb-1"
              >
                Pilih Bulan
              </label>
              <select
                id="monthly-report-month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="field-input text-sm"
              >
                {MONTHS_ID.map((name, idx) => (
                  <option key={name} value={idx + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="monthly-report-year"
                className="block text-xs font-bold text-[#143656] mb-1"
              >
                Pilih Tahun
              </label>
              <input
                id="monthly-report-year"
                type="number"
                min={2024}
                max={2035}
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="field-input tabular-nums text-sm"
              />
            </div>
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
          Menghitung rekap penjualan...
        </div>
      ) : tab === "daily" && dailyData ? (
        <div className="space-y-5">
          <SummaryStrip
            title={`Rekap Harian (${dailyData.date})`}
            totalSales={dailyData.totalSales}
            totalTransactions={dailyData.totalTransactions}
            cashRevenue={dailyData.cashRevenue}
            qrisRevenue={dailyData.qrisRevenue}
          />
          <TransactionsTable
            title={`Daftar Transaksi Harian (${dailyData.date})`}
            transactions={dailyData.transactions}
          />
        </div>
      ) : tab === "monthly" && monthlyData ? (
        <div className="space-y-5">
          <SummaryStrip
            title={`Rekap Bulanan (${MONTHS_ID[monthlyData.month - 1]} ${monthlyData.year})`}
            totalSales={monthlyData.totalSales}
            totalTransactions={monthlyData.totalTransactions}
            cashRevenue={monthlyData.cashRevenue}
            qrisRevenue={monthlyData.qrisRevenue}
          />

          <section aria-label="Grafik penjualan harian" className="surface-card p-5">
            <div className="pb-3 mb-4 border-b border-[#C8BBA2]">
              <h2 className="font-display text-2xl font-extrabold uppercase text-[#143656] leading-none">
                Bagaimana distribusi omzet harian sepanjang {MONTHS_ID[monthlyData.month - 1]}{" "}
                {monthlyData.year}?
              </h2>
              <p className="text-xs text-[#425264] mt-1">
                Rincian pendapatan Tunai dan QRIS untuk setiap tanggal dalam bulan terpilih
              </p>
            </div>
            <div className="h-72 w-full">
              <Bar
                data={{
                  labels: monthlyData.dailySeries.map((d) => String(d.day)),
                  datasets: [
                    {
                      label: "Tunai (Cash)",
                      data: monthlyData.dailySeries.map((d) => d.cash),
                      backgroundColor: "#143656",
                      borderRadius: 3,
                    },
                    {
                      label: "QRIS",
                      data: monthlyData.dailySeries.map((d) => d.qris),
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
                      stacked: true,
                      ticks: { color: "#425264" },
                      grid: { display: false },
                    },
                    y: {
                      stacked: true,
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

          <TransactionsTable
            title={`Daftar Transaksi Bulanan (${MONTHS_ID[monthlyData.month - 1]} ${
              monthlyData.year
            })`}
            transactions={monthlyData.transactions}
          />
        </div>
      ) : null}
    </div>
  );
}

function SummaryStrip({
  title,
  totalSales,
  totalTransactions,
  cashRevenue,
  qrisRevenue,
}: {
  title: string;
  totalSales: number;
  totalTransactions: number;
  cashRevenue: number;
  qrisRevenue: number;
}) {
  return (
    <section aria-label={title} className="ticket-slip overflow-hidden">
      <div className="px-5 py-3 bg-[#143656] text-[#FAF5EA] flex items-center justify-between">
        <h2 className="font-display text-xl font-extrabold uppercase">{title}</h2>
        <span className="px-2.5 py-0.5 rounded-sm bg-[#B3281B] text-white text-xs font-extrabold tabular-nums">
          {totalTransactions} Transaksi
        </span>
      </div>

      <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-3.5 rounded bg-[#F3EAD8] border-2 border-[#143656]">
          <span className="text-xs font-bold text-[#425264] block">Total Omzet Penjualan</span>
          <span className="text-2xl sm:text-3xl font-extrabold text-[#143656] tabular-nums mt-1 block">
            {rupiah(totalSales)}
          </span>
        </div>

        <div className="p-3.5 rounded bg-white border border-[#143656]">
          <span className="text-xs font-bold text-[#425264] block">Pendapatan Tunai (Cash)</span>
          <span className="text-xl font-extrabold text-[#143656] tabular-nums mt-1 block">
            {rupiah(cashRevenue)}
          </span>
        </div>

        <div className="p-3.5 rounded bg-white border border-[#143656]">
          <span className="text-xs font-bold text-[#425264] block">Pendapatan QRIS</span>
          <span className="text-xl font-extrabold text-[#B3281B] tabular-nums mt-1 block">
            {rupiah(qrisRevenue)}
          </span>
        </div>
      </div>
    </section>
  );
}

function TransactionsTable({
  title,
  transactions,
}: {
  title: string;
  transactions: OrderView[];
}) {
  return (
    <section aria-label={title} className="surface-card overflow-hidden">
      <div className="px-5 py-3.5 bg-[#143656] text-[#FAF5EA] flex items-center justify-between">
        <h2 className="font-display text-xl font-extrabold uppercase leading-none">{title}</h2>
        <span className="text-xs font-bold text-[#F3EAD8]/90 tabular-nums">
          {transactions.length} transaksi
        </span>
      </div>

      {transactions.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm font-bold text-[#143656]">
            Tidak ada transaksi penjualan terverifikasi pada periode ini.
          </p>
          <p className="text-xs text-[#425264] mt-1">
            Pilih tanggal atau bulan lain pada filter di atas.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-[#143656] bg-[#F3EAD8] text-xs font-bold text-[#143656]">
                <th className="py-3 px-4">Kode Order</th>
                <th className="py-3 px-3">Minuman Terjual</th>
                <th className="py-3 px-3">Pelanggan</th>
                <th className="py-3 px-3">Metode</th>
                <th className="py-3 px-3">Status Bar</th>
                <th className="py-3 px-3">Waktu Pesan</th>
                <th className="py-3 px-4 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#C8BBA2]">
              {transactions.map((t) => (
                <tr key={t.clientUuid} className="hover:bg-[#F3EAD8]/50">
                  <td className="py-3 px-4 font-extrabold tabular-nums text-[#143656]">
                    {t.orderCode}
                  </td>
                  <td className="py-3 px-3 text-xs font-semibold text-[#1A1917]">
                    {t.items.map((i) => `${i.quantity}x ${i.productName}`).join(", ")}
                  </td>
                  <td className="py-3 px-3 font-medium">{t.customerName || "Umum"}</td>
                  <td className="py-3 px-3 font-bold text-[#143656]">
                    {paymentLabel(t.payment.method)}
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-sm text-xs font-bold ${
                        t.status === "selesai"
                          ? "bg-[#E5F3EB] text-[#175E38]"
                          : "bg-[#B3281B] text-white"
                      }`}
                    >
                      {t.status === "selesai" ? "Order Selesai" : "Order Pending"}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-xs text-[#425264] tabular-nums whitespace-nowrap">
                    {formatDateTime(t.approvedAt)}
                  </td>
                  <td className="py-3 px-4 text-right font-extrabold tabular-nums text-[#B3281B]">
                    {rupiah(t.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
