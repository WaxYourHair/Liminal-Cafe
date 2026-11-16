"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { flushOfflineOutbox, getOutboxCount } from "@/lib/offline";

export interface ShellUser {
  id: number;
  name: string;
  username: string;
  role: "admin" | "kasir";
}

interface NavItem {
  href: string;
  label: string;
  group: "counter" | "manage";
  matchPrefix?: string[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/pos", label: "Order Baru", group: "counter", matchPrefix: ["/pos", "/payment"] },
  { href: "/orders/pending", label: "Order Pending", group: "counter" },
  { href: "/orders/completed", label: "Order Selesai", group: "counter" },
  { href: "/dashboard", label: "Ringkasan", group: "manage" },
  { href: "/menu", label: "Menu & Harga", group: "manage", matchPrefix: ["/menu", "/categories"] },
  { href: "/reports", label: "Laporan", group: "manage", matchPrefix: ["/reports"] },
  { href: "/settings", label: "Pengaturan", group: "manage" },
];

export default function AppShell({
  user,
  cafeName = "Liminal Campervan Bar",
  children,
}: {
  user: ShellUser;
  cafeName?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [outboxCount, setOutboxCount] = useState(0);
  const [syncingOutbox, setSyncingOutbox] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const counterNav = NAV_ITEMS.filter((i) => i.group === "counter");
  const manageNav = NAV_ITEMS.filter((i) => i.group === "manage");

  useEffect(() => {
    setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    const refreshCount = async () => {
      const count = await getOutboxCount();
      setOutboxCount(count);
    };

    const handleOnline = async () => {
      setIsOnline(true);
      setSyncingOutbox(true);
      await flushOfflineOutbox();
      await refreshCount();
      setSyncingOutbox(false);
      router.refresh();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    refreshCount();
    if (navigator.onLine) {
      flushOfflineOutbox().then(refreshCount);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("liminal-outbox-change", refreshCount);

    const interval = window.setInterval(() => {
      if (navigator.onLine) {
        flushOfflineOutbox().then(refreshCount);
      } else {
        refreshCount();
      }
    }, 20000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("liminal-outbox-change", refreshCount);
      window.clearInterval(interval);
    };
  }, [router]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  async function handleFlushNow() {
    setSyncingOutbox(true);
    try {
      await flushOfflineOutbox();
      setOutboxCount(await getOutboxCount());
      router.refresh();
    } finally {
      setSyncingOutbox(false);
    }
  }

  function isActive(item: NavItem) {
    if (item.matchPrefix) {
      return item.matchPrefix.some((p) => pathname === p || pathname.startsWith(`${p}/`));
    }
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  return (
    <div className="min-h-dvh flex flex-col bg-[#F3EAD8] text-[#1A1917]">
      {/* Top Campervan Bar Counter Header */}
      <header className="sticky top-0 z-30 bg-[#143656] text-[#FAF5EA] border-b-2 border-[#0E2740]">
        <div className="checker-strip" aria-hidden="true" />

        <div className="max-w-[1440px] mx-auto px-3 sm:px-5">
          <div className="flex items-center justify-between gap-3 py-2.5">
            {/* Brand identity lockup */}
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setDrawerOpen((v) => !v)}
                aria-expanded={drawerOpen}
                aria-controls="mobile-nav-drawer"
                aria-label={drawerOpen ? "Tutup menu navigasi" : "Buka menu navigasi"}
                className="lg:hidden inline-flex items-center justify-center min-w-[44px] min-h-[44px] px-2.5 rounded bg-[#0E2740] text-[#FAF5EA] border border-[#FAF5EA]/30 text-xs font-bold"
              >
                {drawerOpen ? "Tutup" : "Menu"}
              </button>

              <Link
                href="/pos"
                className="flex items-center gap-3 min-w-0 group focus-visible:outline-[#FAF5EA]"
              >
                <div className="w-16 sm:w-20 rounded overflow-hidden border border-[#FAF5EA]/40 bg-[#E6D7BE] shrink-0">
                  <img
                    src="/logo-banner.jpg"
                    alt={`Logo ${cafeName}`}
                    width={160}
                    height={90}
                    fetchPriority="high"
                    className="w-full h-auto block object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <p className="font-display text-lg sm:text-xl font-extrabold uppercase leading-none text-[#FAF5EA] truncate">
                    {cafeName}
                  </p>
                  <p className="text-[11px] font-semibold text-[#F3EAD8]/80 truncate mt-0.5">
                    Coffee. Culture. Street.
                  </p>
                </div>
              </Link>
            </div>

            {/* Desktop & Landscape Tablet Grouped Counter Navigation */}
            <nav
              aria-label="Navigasi utama"
              className="hidden lg:flex items-center gap-2"
            >
              {/* Primary Bar Counter Mode Group */}
              <div
                role="group"
                aria-label="Operasional Kasir dan Pesanan"
                className="flex items-center bg-[#0E2740] p-1 rounded border border-[#FAF5EA]/20 gap-1"
              >
                {counterNav.map((item) => {
                  const active = isActive(item);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`inline-flex items-center justify-center whitespace-nowrap min-h-[40px] px-3.5 py-1.5 rounded-sm text-sm font-bold transition-colors ${
                        active
                          ? "bg-[#B3281B] text-white shadow-[2px_2px_0_#081726]"
                          : "text-[#FAF5EA] hover:bg-[#1C466E]"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>

              <span className="h-6 w-px bg-[#FAF5EA]/25 mx-1" aria-hidden="true" />

              {/* Secondary Management Group */}
              <div
                role="group"
                aria-label="Manajemen Menu dan Laporan"
                className="flex items-center gap-1"
              >
                {manageNav.map((item) => {
                  const active = isActive(item);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`inline-flex items-center justify-center whitespace-nowrap min-h-[40px] px-3 py-1.5 rounded-sm text-sm font-semibold border-b-2 transition-colors ${
                        active
                          ? "border-[#FAF5EA] bg-[#1C466E] text-white font-bold"
                          : "border-transparent text-[#F3EAD8]/90 hover:text-white hover:bg-[#0E2740]"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </nav>

            {/* Right Status & Session Actions */}
            <div className="flex items-center gap-2 shrink-0">
              {outboxCount > 0 && (
                <button
                  type="button"
                  onClick={handleFlushNow}
                  disabled={syncingOutbox || !isOnline}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded text-xs font-bold bg-[#B3281B] text-white border border-[#FAF5EA]/40"
                >
                  <span className="tabular-nums">
                    {syncingOutbox ? "Sinkron..." : `${outboxCount} Antrean Offline`}
                  </span>
                </button>
              )}

              {!isOnline && (
                <span className="inline-flex items-center px-2.5 py-1.5 rounded text-xs font-bold bg-[#B3281B] text-white">
                  Offline Tablet
                </span>
              )}

              <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-[#FAF5EA]/20">
                <span className="text-xs text-[#F3EAD8]/90">
                  Kasir: <strong className="text-white">{user.name}</strong>
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="inline-flex items-center justify-center min-h-[40px] px-3 py-1.5 rounded text-xs font-bold bg-[#0E2740] text-[#FAF5EA] border border-[#FAF5EA]/30 hover:bg-[#B3281B] hover:border-[#B3281B] transition-colors"
                >
                  {loggingOut ? "Keluar..." : "Keluar"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Tablet Portrait / Mobile Quick Operational Bar */}
        <nav
          aria-label="Akses cepat kasir"
          className="lg:hidden grid grid-cols-3 border-t border-[#FAF5EA]/20 bg-[#0E2740]"
        >
          {counterNav.map((tab) => {
            const active = isActive(tab);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center justify-center min-h-[44px] px-2 text-xs sm:text-sm font-bold text-center border-b-4 transition-colors ${
                  active
                    ? "border-[#B3281B] bg-[#143656] text-white"
                    : "border-transparent text-[#F3EAD8]/85 hover:text-white"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* Mobile / Portrait Tablet Navigation Sheet */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div
            className="fixed inset-0 bg-black/55"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div
            id="mobile-nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Menu navigasi"
            className="relative z-50 w-72 max-w-[85vw] bg-[#143656] text-[#FAF5EA] border-r-2 border-[#0E2740] flex flex-col justify-between p-4 overflow-y-auto"
          >
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-[#FAF5EA]/20">
                <div>
                  <p className="font-display text-lg font-extrabold uppercase text-white">
                    {cafeName}
                  </p>
                  <p className="text-xs text-[#F3EAD8]/80">Kasir aktif: {user.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Tutup menu"
                  className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] px-3 rounded bg-[#0E2740] text-white text-xs font-bold border border-[#FAF5EA]/30"
                >
                  Tutup
                </button>
              </div>

              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs font-bold text-[#F3EAD8]/70 px-2 mb-1.5">
                    Meja Kasir & Bar
                  </p>
                  <nav className="space-y-1" aria-label="Menu operasional">
                    {counterNav.map((item) => {
                      const active = isActive(item);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={`flex items-center justify-between min-h-[44px] px-3 py-2.5 rounded text-sm font-bold ${
                            active
                              ? "bg-[#B3281B] text-white"
                              : "text-[#FAF5EA] hover:bg-[#0E2740]"
                          }`}
                        >
                          <span>{item.label}</span>
                        </Link>
                      );
                    })}
                  </nav>
                </div>

                <div>
                  <p className="text-xs font-bold text-[#F3EAD8]/70 px-2 mb-1.5">
                    Manajemen & Laporan
                  </p>
                  <nav className="space-y-1" aria-label="Menu manajemen">
                    {manageNav.map((item) => {
                      const active = isActive(item);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={`flex items-center justify-between min-h-[44px] px-3 py-2.5 rounded text-sm font-bold ${
                            active
                              ? "bg-[#B3281B] text-white"
                              : "text-[#FAF5EA] hover:bg-[#0E2740]"
                          }`}
                        >
                          <span>{item.label}</span>
                        </Link>
                      );
                    })}
                  </nav>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-[#FAF5EA]/20">
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                className="w-full flex items-center justify-center min-h-[44px] px-3 py-2 rounded text-sm font-bold bg-[#0E2740] text-white border border-[#FAF5EA]/30"
              >
                {loggingOut ? "Keluar..." : "Keluar Sesi"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Workspace Canvas */}
      <main
        id="main-content"
        className="flex-1 min-w-0 px-3 sm:px-5 py-4 sm:py-5 max-w-[1440px] w-full mx-auto"
      >
        {children}
      </main>
    </div>
  );
}
