"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { rupiah } from "@/lib/format";
import { cartTotal } from "@/lib/schemas";
import {
  allocateOrderCode,
  loadCatalogWithCache,
  submitApprovedOrder,
  type CatalogSnapshot,
} from "@/lib/offline";

export interface CartItem {
  productId: number;
  productName: string;
  categoryName: string;
  price: number;
  quantity: number;
  notes: string;
}

const CART_STORAGE_KEY = "liminal_active_cart_v1";

export default function PosWorkspace({
  initialStep = "catalog",
}: {
  initialStep?: "catalog" | "payment";
}) {
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | "all">("all");

  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  const [paymentModalOpen, setPaymentModalOpen] = useState(initialStep === "payment");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "qris">("cash");
  const [cashReceivedInput, setCashReceivedInput] = useState("");
  const [paymentVerified, setPaymentVerified] = useState(false);
  const [qrisFullOpen, setQrisFullOpen] = useState(false);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [lastApproved, setLastApproved] = useState<{
    orderCode: string;
    total: number;
    change: number;
    method: "cash" | "qris";
    synced: boolean;
  } | null>(null);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(CART_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          cart?: CartItem[];
          customerName?: string;
          orderNotes?: string;
        };
        if (Array.isArray(parsed.cart)) setCart(parsed.cart);
        if (typeof parsed.customerName === "string") setCustomerName(parsed.customerName);
        if (typeof parsed.orderNotes === "string") setOrderNotes(parsed.orderNotes);
      }
    } catch {
      // Ignore malformed sessionStorage data
    }
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        CART_STORAGE_KEY,
        JSON.stringify({ cart, customerName, orderNotes }),
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [cart, customerName, orderNotes]);

  async function refreshCatalog() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await loadCatalogWithCache();
      setCatalog(res.snapshot);
      setFromCache(res.fromCache);
    } catch {
      setLoadError("Gagal memuat daftar menu. Periksa koneksi jaringan Anda.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshCatalog();
  }, []);

  const filteredProducts = useMemo(() => {
    if (!catalog) return [];
    const q = searchQuery.trim().toLowerCase();
    return catalog.products.filter((p) => {
      if (selectedCategoryId !== "all" && p.category_id !== selectedCategoryId) return false;
      if (
        q &&
        !p.name.toLowerCase().includes(q) &&
        !(p.description ?? "").toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [catalog, searchQuery, selectedCategoryId]);

  const groupedSections = useMemo(() => {
    if (!catalog) return [];
    const byCategory = new Map<number, CatalogSnapshot["products"]>();
    for (const prod of filteredProducts) {
      const list = byCategory.get(prod.category_id) ?? [];
      list.push(prod);
      byCategory.set(prod.category_id, list);
    }
    return catalog.categories
      .map((cat) => ({
        category: cat,
        products: byCategory.get(cat.id) ?? [],
      }))
      .filter((section) => section.products.length > 0);
  }, [catalog, filteredProducts]);

  const total = useMemo(() => cartTotal(cart), [cart]);
  const totalItems = useMemo(() => cart.reduce((acc, item) => acc + item.quantity, 0), [cart]);

  const cashReceived = useMemo(() => {
    const cleaned = cashReceivedInput.replace(/[^\d]/g, "");
    return cleaned ? Number.parseInt(cleaned, 10) : 0;
  }, [cashReceivedInput]);

  const cashSufficient = paymentMethod === "cash" ? cashReceived >= total && total > 0 : true;
  const cashChange = paymentMethod === "cash" && cashReceived >= total ? cashReceived - total : 0;
  const canApprove = cart.length > 0 && cashSufficient && !submittingOrder;

  function addToCart(product: CatalogSnapshot["products"][number]) {
    setLastApproved(null);
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.productId === product.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + 1 };
        return updated;
      }
      return [
        ...prev,
        {
          productId: product.id,
          productName: product.name,
          categoryName: product.category_name,
          price: product.price,
          quantity: 1,
          notes: "",
        },
      ];
    });
  }

  function updateQuantity(productId: number, delta: number) {
    setCart((prev) =>
      prev
        .map((item) =>
          item.productId === productId ? { ...item, quantity: item.quantity + delta } : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }

  function removeItem(productId: number) {
    setCart((prev) => prev.filter((item) => item.productId !== productId));
  }

  function updateItemNotes(productId: number, notes: string) {
    setCart((prev) =>
      prev.map((item) => (item.productId === productId ? { ...item, notes } : item)),
    );
  }

  function clearCart() {
    setCart([]);
    setCustomerName("");
    setOrderNotes("");
    setPaymentVerified(false);
    setCashReceivedInput("");
    setSubmitError(null);
  }

  function openPaymentDialog(defaultMethod?: "cash" | "qris") {
    if (cart.length === 0) return;
    if (defaultMethod) setPaymentMethod(defaultMethod);
    setPaymentVerified(false);
    setSubmitError(null);
    if (!cashReceivedInput || Number(cashReceivedInput) < total) {
      setCashReceivedInput(String(total));
    }
    setMobileCartOpen(false);
    setPaymentModalOpen(true);
  }

  async function handleAccOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!catalog || !canApprove) return;

    setSubmittingOrder(true);
    setSubmitError(null);
    try {
      const orderCode = allocateOrderCode(catalog.nextSequence);
      const clientUuid =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0")}`;

      const op = {
        type: "create" as const,
        clientUuid,
        orderCode,
        userId: catalog.user.id,
        customerName: customerName.trim() || null,
        notes: orderNotes.trim() || null,
        items: cart.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          price: item.price,
          quantity: item.quantity,
          notes: item.notes.trim() || null,
        })),
        payment: {
          method: paymentMethod,
          paidAmount: paymentMethod === "cash" ? cashReceived : total,
          verified: true as const,
        },
        approvedAt: new Date().toISOString(),
      };

      const res = await submitApprovedOrder(op, catalog.user.name);
      setLastApproved({
        orderCode: res.orderCode,
        total,
        change: paymentMethod === "cash" ? cashChange : 0,
        method: paymentMethod,
        synced: res.synced,
      });

      setCatalog((prev) => (prev ? { ...prev, nextSequence: prev.nextSequence + 1 } : prev));
      clearCart();
      setPaymentModalOpen(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Gagal memproses pesanan.");
    } finally {
      setSubmittingOrder(false);
    }
  }

  const quantityByProduct = useMemo(() => {
    const map = new Map<number, number>();
    for (const item of cart) map.set(item.productId, item.quantity);
    return map;
  }, [cart]);

  return (
    <div className="pb-20 lg:pb-4">
      {fromCache && (
        <div
          role="status"
          className="mb-4 px-3.5 py-2.5 rounded bg-[#FAF5EA] border-2 border-[#143656] text-xs font-bold text-[#143656] flex items-center justify-between"
        >
          <span>Mode Offline Tablet aktif: menampilkan daftar menu tersimpan di perangkat.</span>
        </div>
      )}

      {/* Confirmation receipt banner after an order is created */}
      {lastApproved && (
        <section
          aria-label="Pesanan berhasil dibuat"
          className="mb-5 p-4 rounded bg-[#E5F3EB] border-2 border-[#175E38] text-[#175E38] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        >
          <div>
            <h2 className="text-base font-bold">
              Pesanan <span className="tabular-nums font-extrabold">{lastApproved.orderCode}</span>{" "}
              berhasil dibuat dan masuk ke antrean Order Pending
            </h2>
            <p className="text-sm mt-0.5">
              Pembayaran: <strong>{lastApproved.method === "qris" ? "QRIS" : "Tunai"}</strong> ·
              Total: <strong className="tabular-nums">{rupiah(lastApproved.total)}</strong>
              {lastApproved.method === "cash" && (
                <>
                  {" "}
                  · Kembalian:{" "}
                  <strong className="tabular-nums">{rupiah(lastApproved.change)}</strong>
                </>
              )}
              {!lastApproved.synced && " · Tersimpan di antrean offline tablet"}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/orders/pending" className="btn-primary text-xs py-2 px-3">
              Buka Order Pending
            </Link>
            <button
              type="button"
              onClick={() => setLastApproved(null)}
              className="btn-secondary text-xs py-2 px-3"
            >
              Tutup
            </button>
          </div>
        </section>
      )}

      {/* Loading & Error states (R-27) */}
      {loading && !catalog && (
        <div role="status" aria-live="polite" className="surface-card p-8 text-center">
          <p className="text-base font-bold text-[#143656]">Memuat papan menu Liminal...</p>
          <p className="text-sm text-[#425264] mt-1">
            Menyiapkan daftar minuman dan harga dari database lokal.
          </p>
        </div>
      )}

      {loadError && !catalog && (
        <div
          role="alert"
          className="p-6 rounded bg-[#FBE9E7] border-2 border-[#941F14] text-[#941F14]"
        >
          <h2 className="text-base font-bold">Gagal memuat papan menu</h2>
          <p className="text-sm mt-1">{loadError}</p>
          <button type="button" onClick={refreshCatalog} className="btn-danger mt-4">
            Muat Ulang Menu
          </button>
        </div>
      )}

      {catalog && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: Liminal Poster Menu Board (8 cols on desktop/landscape tablet) */}
          <section aria-label="Papan Menu Minuman" className="lg:col-span-8 space-y-5">
            {/* Compact Barista Filter & Search Strip */}
            <div className="surface-card p-3 sm:p-3.5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-baseline gap-2">
                  <h1 className="font-display text-2xl sm:text-3xl font-extrabold uppercase text-[#143656] leading-none">
                    Daftar Menu Bar
                  </h1>
                  <span className="text-xs font-bold text-[#425264] tabular-nums">
                    ({filteredProducts.length} minuman)
                  </span>
                </div>

                <div className="w-full sm:w-72">
                  <label htmlFor="pos-search-input" className="sr-only">
                    Cari nama minuman
                  </label>
                  <input
                    id="pos-search-input"
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari menu (mis. Dirty Latte, V60, Squash)..."
                    className="field-input text-sm min-h-[42px] py-1.5"
                  />
                </div>
              </div>

              {/* Category Filter Tabs */}
              <div
                role="tablist"
                aria-label="Filter kategori minuman"
                className="flex flex-wrap items-center gap-1.5 pt-2.5 border-t border-[#C8BBA2]"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedCategoryId === "all"}
                  onClick={() => setSelectedCategoryId("all")}
                  className={`min-h-[42px] px-3.5 py-1.5 rounded-sm text-xs sm:text-sm font-bold shrink-0 border transition-colors ${
                    selectedCategoryId === "all"
                      ? "bg-[#143656] text-[#FAF5EA] border-[#143656]"
                      : "bg-[#F3EAD8] text-[#143656] border-[#143656]/40 hover:bg-[#EAE0C8]"
                  }`}
                >
                  Semua ({catalog.products.length})
                </button>
                {catalog.categories.map((cat) => {
                  const active = selectedCategoryId === cat.id;
                  const isSignature = cat.name.toLowerCase() === "signature";
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setSelectedCategoryId(cat.id)}
                      className={`min-h-[42px] px-3.5 py-1.5 rounded-sm text-xs sm:text-sm font-bold shrink-0 border transition-colors ${
                        active
                          ? "bg-[#B3281B] text-white border-[#143656]"
                          : "bg-[#F3EAD8] text-[#143656] border-[#143656]/40 hover:bg-[#EAE0C8]"
                      }`}
                    >
                      {isSignature ? `★ ${cat.name}` : cat.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Menu Board Content */}
            {groupedSections.length === 0 ? (
              <div className="surface-card p-8 text-center">
                <p className="text-base font-bold text-[#143656]">
                  Tidak ada minuman yang cocok dengan pencarian &ldquo;{searchQuery}&rdquo;
                </p>
                <p className="text-sm text-[#425264] mt-1">
                  Gunakan kata kunci lain atau tampilkan kembali seluruh kategori menu.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedCategoryId("all");
                  }}
                  className="btn-secondary mt-4"
                >
                  Tampilkan Semua Menu
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {groupedSections.map(({ category, products }) => {
                  const isSignature = category.name.toLowerCase() === "signature";

                  if (isSignature) {
                    /* Flagship Signature Showcase (R-14 hierarchy variation, matching the poster's ★ SIGNATURE section) */
                    return (
                      <section
                        key={category.id}
                        aria-labelledby={`cat-heading-${category.id}`}
                        className="p-4 rounded-md bg-[#FAF5EA] border-2 border-[#143656] shadow-[4px_4px_0_#143656]"
                      >
                        <div className="flex items-center gap-3 pb-3 mb-3.5 border-b-2 border-[#B3281B]">
                          <span
                            aria-hidden="true"
                            className="text-xl leading-none text-[#B3281B] font-bold"
                          >
                            ★
                          </span>
                          <h2
                            id={`cat-heading-${category.id}`}
                            className="font-display text-2xl font-extrabold uppercase text-[#143656] tracking-wide leading-none"
                          >
                            {category.name}
                          </h2>
                          {category.description && (
                            <span className="text-xs font-bold text-[#425264]">
                              · {category.description}
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                          {products.map((product) => {
                            const qtyInCart = quantityByProduct.get(product.id) ?? 0;
                            return (
                              <article
                                key={product.id}
                                className={`p-3 rounded border transition-colors flex flex-col justify-between ${
                                  qtyInCart > 0
                                    ? "bg-white border-2 border-[#B3281B] shadow-[3px_3px_0_#143656]"
                                    : "bg-[#F3EAD8]/70 border-[#143656]"
                                }`}
                              >
                                <div className="flex gap-3">
                                  <div className="w-20 h-20 rounded-sm bg-[#EAE0C8] border border-[#143656] shrink-0 overflow-hidden">
                                    {product.image ? (
                                      <img
                                        src={product.image}
                                        alt={product.name}
                                        width={80}
                                        height={80}
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center font-display font-bold text-lg text-[#143656]">
                                        {product.name.slice(0, 2).toUpperCase()}
                                      </div>
                                    )}
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-start justify-between gap-1">
                                      <h3 className="text-base font-extrabold text-[#143656] leading-tight">
                                        {product.name}
                                      </h3>
                                    </div>
                                    {product.description && (
                                      <p className="text-xs text-[#425264] line-clamp-2 mt-1 leading-snug">
                                        {product.description}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                <div className="flex items-center justify-between gap-2 pt-2.5 mt-3 border-t border-[#C8BBA2]">
                                  <span className="text-base font-extrabold text-[#B3281B] tabular-nums">
                                    {rupiah(product.price)}
                                  </span>

                                  <ProductCounterControl
                                    product={product}
                                    qtyInCart={qtyInCart}
                                    onAdd={() => addToCart(product)}
                                    onDelta={(d) => updateQuantity(product.id, d)}
                                  />
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </section>
                    );
                  }

                  /* Standard Poster Category Section (Espresso-Based, Manual Brew, Non-Coffee, Refreshers) */
                  return (
                    <section
                      key={category.id}
                      aria-labelledby={`cat-heading-${category.id}`}
                      className="space-y-3"
                    >
                      <div className="flex items-center gap-3">
                        <h2
                          id={`cat-heading-${category.id}`}
                          className="font-display text-2xl font-extrabold uppercase text-[#143656] leading-none shrink-0"
                        >
                          {category.name}
                        </h2>
                        {category.description && (
                          <span className="text-xs font-bold text-[#B3281B] uppercase shrink-0">
                            {category.description}
                          </span>
                        )}
                        <span className="h-0.5 flex-1 bg-[#143656]/30" aria-hidden="true" />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {products.map((product) => {
                          const qtyInCart = quantityByProduct.get(product.id) ?? 0;
                          return (
                            <article
                              key={product.id}
                              className={`p-2.5 rounded border transition-colors flex items-center justify-between gap-3 ${
                                qtyInCart > 0
                                  ? "surface-card-active"
                                  : "surface-card hover:bg-white"
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className="w-16 h-16 rounded-sm bg-[#EAE0C8] border border-[#143656] shrink-0 overflow-hidden">
                                  {product.image ? (
                                    <img
                                      src={product.image}
                                      alt={product.name}
                                      width={64}
                                      height={64}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center font-display font-bold text-base text-[#143656]">
                                      {product.name.slice(0, 2).toUpperCase()}
                                    </div>
                                  )}
                                </div>

                                <div className="min-w-0 flex-1">
                                  <h3 className="text-sm sm:text-base font-bold text-[#1A1917] leading-tight truncate">
                                    {product.name}
                                  </h3>
                                  <p className="text-sm font-extrabold text-[#B3281B] tabular-nums mt-1">
                                    {rupiah(product.price)}
                                  </p>
                                </div>
                              </div>

                              <div className="shrink-0">
                                <ProductCounterControl
                                  product={product}
                                  qtyInCart={qtyInCart}
                                  onAdd={() => addToCart(product)}
                                  onDelta={(d) => updateQuantity(product.id, d)}
                                />
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </section>

          {/* Right Column: Sticky Barista Order Slip (4 cols on desktop/landscape tablet) */}
          <aside
            aria-label="Slip Pesanan Kasir"
            className="hidden lg:block lg:col-span-4 sticky top-20 ticket-slip overflow-hidden"
          >
            <CartTicketContent
              cart={cart}
              total={total}
              totalItems={totalItems}
              customerName={customerName}
              setCustomerName={setCustomerName}
              orderNotes={orderNotes}
              setOrderNotes={setOrderNotes}
              updateQuantity={updateQuantity}
              removeItem={removeItem}
              updateItemNotes={updateItemNotes}
              clearCart={clearCart}
              onProceedPayment={openPaymentDialog}
            />
          </aside>
        </div>
      )}

      {/* Portrait Tablet / Mobile bottom sticky order bar */}
      {catalog && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-[#143656] text-[#FAF5EA] border-t-2 border-[#0E2740] px-4 py-2.5 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-[#F3EAD8]/85">
              {totalItems > 0 ? `${totalItems} gelas dipilih` : "Belum ada menu dipilih"}
            </p>
            <p className="text-lg font-extrabold tabular-nums text-white">{rupiah(total)}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileCartOpen(true)}
              className="btn-secondary text-xs sm:text-sm py-2 px-3"
            >
              <span>Slip ({totalItems})</span>
            </button>
            <button
              type="button"
              disabled={cart.length === 0}
              onClick={() => openPaymentDialog()}
              className="btn-accent text-xs sm:text-sm py-2 px-4"
            >
              Bayar Pesanan
            </button>
          </div>
        </div>
      )}

      {/* Portrait Tablet / Mobile Slip Drawer */}
      {mobileCartOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex flex-col justify-end">
          <div
            className="fixed inset-0 bg-black/55"
            onClick={() => setMobileCartOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Slip pesanan kasir"
            className="relative z-50 max-h-[88dvh] overflow-y-auto modal-elevated rounded-b-none"
          >
            <div className="flex items-center justify-between px-4 py-3 bg-[#143656] text-[#FAF5EA]">
              <h2 className="font-display text-xl font-extrabold uppercase">Slip Pesanan Bar</h2>
              <button
                type="button"
                onClick={() => setMobileCartOpen(false)}
                aria-label="Tutup slip pesanan"
                className="min-w-[44px] min-h-[40px] px-3 rounded bg-[#0E2740] text-white text-xs font-bold border border-[#FAF5EA]/30"
              >
                Tutup
              </button>
            </div>
            <CartTicketContent
              cart={cart}
              total={total}
              totalItems={totalItems}
              customerName={customerName}
              setCustomerName={setCustomerName}
              orderNotes={orderNotes}
              setOrderNotes={setOrderNotes}
              updateQuantity={updateQuantity}
              removeItem={removeItem}
              updateItemNotes={updateItemNotes}
              clearCart={clearCart}
              onProceedPayment={openPaymentDialog}
              hideHeader
            />
          </div>
        </div>
      )}

      {/* Payment Modal (Cash & QRIS) */}
      {paymentModalOpen && catalog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => !submittingOrder && setPaymentModalOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-dialog-title"
            className="relative z-10 w-full max-w-xl modal-elevated my-auto max-h-[94dvh] overflow-y-auto"
          >
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 bg-[#143656] text-[#FAF5EA] border-b-2 border-[#0E2740]">
              <h2
                id="payment-dialog-title"
                className="font-display text-2xl font-extrabold uppercase leading-none"
              >
                {paymentMethod === "cash" ? "Pembayaran Tunai" : "Pembayaran QRIS"}
              </h2>
              <button
                type="button"
                disabled={submittingOrder}
                onClick={() => setPaymentModalOpen(false)}
                aria-label="Tutup jendela pembayaran"
                className="min-w-[44px] min-h-[40px] px-3 rounded bg-[#0E2740] text-white text-xs font-bold border border-[#FAF5EA]/30"
              >
                Tutup
              </button>
            </div>

            <form onSubmit={handleAccOrder} className="p-5 space-y-5">
              {/* Order Summary Banner */}
              <div className="p-3.5 rounded bg-[#F3EAD8] border-2 border-[#143656] flex items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-bold text-[#425264] block">Pelanggan</span>
                  <p className="text-base font-extrabold text-[#143656]">
                    {customerName.trim() || "Umum"} · {totalItems} item
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-[#425264] block">Total Tagihan</span>
                  <span className="text-2xl font-extrabold text-[#B3281B] tabular-nums">
                    {rupiah(total)}
                  </span>
                </div>
              </div>

              {/* CASH flow */}
              {paymentMethod === "cash" && (
                <div className="space-y-4 p-4 rounded bg-white border-2 border-[#143656]">
                  <div>
                    <label
                      htmlFor="cash-received-input"
                      className="block text-sm font-bold text-[#143656] mb-1.5"
                    >
                      Nominal Uang Tunai Diterima (Rp)
                    </label>
                    <input
                      id="cash-received-input"
                      type="text"
                      inputMode="numeric"
                      value={cashReceivedInput}
                      onChange={(e) => setCashReceivedInput(e.target.value.replace(/[^\d]/g, ""))}
                      placeholder="Masukkan nominal uang diterima"
                      className="field-input tabular-nums text-lg font-bold"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "Uang Pas", val: total },
                      { label: "Rp 20.000", val: 20000 },
                      { label: "Rp 50.000", val: 50000 },
                      { label: "Rp 100.000", val: 100000 },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setCashReceivedInput(String(preset.val))}
                        className="btn-secondary text-xs py-1.5 px-3 min-h-[40px] tabular-nums"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  <div
                    className={`p-3.5 rounded border-2 flex items-center justify-between ${
                      cashSufficient
                        ? "bg-[#E5F3EB] border-[#175E38] text-[#175E38]"
                        : "bg-[#FBE9E7] border-[#941F14] text-[#941F14]"
                    }`}
                  >
                    <span className="text-sm font-bold">
                      {cashSufficient ? "Kembalian Pelanggan" : "Nominal Uang Kurang"}
                    </span>
                    <span className="text-xl font-extrabold tabular-nums">
                      {cashSufficient ? rupiah(cashChange) : rupiah(total - cashReceived)}
                    </span>
                  </div>
                </div>
              )}

              {/* QRIS flow: Clean Tampilkan QRIS button */}
              {paymentMethod === "qris" && (
                <div className="p-4 rounded bg-white border-2 border-[#143656]">
                  <button
                    type="button"
                    onClick={() => setQrisFullOpen(true)}
                    className="btn-primary w-full py-3.5 text-base"
                  >
                    Tampilkan QRIS
                  </button>
                </div>
              )}

              {submitError && (
                <div
                  role="alert"
                  className="p-3 rounded bg-[#FBE9E7] border-2 border-[#941F14] text-[#941F14] text-sm font-bold"
                >
                  {submitError}
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 pt-3 border-t border-[#C8BBA2]">
                <button
                  type="button"
                  disabled={submittingOrder}
                  onClick={() => setPaymentModalOpen(false)}
                  className="btn-secondary"
                >
                  Kembali
                </button>
                <button
                  type="submit"
                  disabled={!canApprove}
                  className="btn-accent px-6 py-3 text-base"
                >
                  {submittingOrder ? "Memproses..." : "Selesaikan Pembayaran"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Fullscreen QRIS View (clean display without instructions) */}
      {qrisFullOpen && catalog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Kode QRIS"
          className="fixed inset-0 z-[60] bg-[#143656]/95 flex flex-col items-center justify-center p-4"
          onClick={() => setQrisFullOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white rounded-md border-2 border-[#FAF5EA] p-4 flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={catalog.qris.url}
              alt="QRIS Liminal Campervan Bar"
              width={420}
              height={460}
              className="w-full max-h-[75dvh] object-contain rounded"
            />
            <button
              type="button"
              onClick={() => setQrisFullOpen(false)}
              className="btn-primary w-full py-3"
            >
              Tutup QRIS
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductCounterControl({
  product,
  qtyInCart,
  onAdd,
  onDelta,
}: {
  product: CatalogSnapshot["products"][number];
  qtyInCart: number;
  onAdd: () => void;
  onDelta: (delta: number) => void;
}) {
  if (qtyInCart === 0) {
    return (
      <button
        type="button"
        onClick={onAdd}
        aria-label={`Tambah ${product.name} ke pesanan`}
        className="btn-primary text-xs sm:text-sm py-2 px-3.5 min-h-[44px]"
      >
        + Tambah
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => onDelta(-1)}
        aria-label={`Kurangi jumlah ${product.name}`}
        className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-sm bg-white border-2 border-[#143656] text-[#143656] font-extrabold text-base hover:bg-[#EAE0C8]"
      >
        -
      </button>
      <span
        aria-live="polite"
        className="min-w-[28px] text-center font-extrabold text-base text-[#143656] tabular-nums"
      >
        {qtyInCart}
      </span>
      <button
        type="button"
        onClick={() => onDelta(1)}
        aria-label={`Tambah jumlah ${product.name}`}
        className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-sm bg-[#B3281B] border-2 border-[#143656] text-white font-extrabold text-base hover:bg-[#941F14]"
      >
        +
      </button>
    </div>
  );
}

function CartTicketContent({
  cart,
  total,
  totalItems,
  customerName,
  setCustomerName,
  orderNotes,
  setOrderNotes,
  updateQuantity,
  removeItem,
  updateItemNotes,
  clearCart,
  onProceedPayment,
  hideHeader = false,
}: {
  cart: CartItem[];
  total: number;
  totalItems: number;
  customerName: string;
  setCustomerName: (v: string) => void;
  orderNotes: string;
  setOrderNotes: (v: string) => void;
  updateQuantity: (productId: number, delta: number) => void;
  removeItem: (productId: number) => void;
  updateItemNotes: (productId: number, notes: string) => void;
  clearCart: () => void;
  onProceedPayment: (method?: "cash" | "qris") => void;
  hideHeader?: boolean;
}) {
  return (
    <div>
      {!hideHeader && (
        <div className="px-4 py-3 bg-[#143656] text-[#FAF5EA] border-b-2 border-[#0E2740] flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl font-extrabold uppercase leading-none">
              Slip Pesanan Bar
            </h2>
            <p className="text-xs text-[#F3EAD8]/85 tabular-nums mt-0.5">
              {totalItems > 0 ? `${totalItems} gelas dalam slip` : "Siap mencatat pesanan baru"}
            </p>
          </div>
          {cart.length > 0 && (
            <button
              type="button"
              onClick={clearCart}
              className="text-xs font-bold text-[#FAF5EA] underline hover:text-white min-h-[38px] px-2"
            >
              Reset Slip
            </button>
          )}
        </div>
      )}

      <div className="p-4 space-y-4">
        {/* Customer Name & Order Note compact header fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2.5">
          <div>
            <label
              htmlFor="cart-customer-name"
              className="block text-xs font-bold text-[#143656] mb-1"
            >
              Nama Pelanggan (Opsional)
            </label>
            <input
              id="cart-customer-name"
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Mis. Raka / Kursi Depan"
              className="field-input text-sm min-h-[40px] py-1.5"
            />
          </div>
        </div>

        {/* Itemized Receipt Area */}
        {cart.length === 0 ? (
          <div className="py-7 px-4 text-center rounded bg-[#F3EAD8] border-2 border-[#143656]/40">
            <p className="text-sm font-bold text-[#143656]">Slip pesanan masih kosong</p>
            <p className="text-xs text-[#425264] mt-1">
              Ketuk tombol <strong>+ Tambah</strong> pada minuman di papan menu kiri untuk mulai
              mencatat pesanan pelanggan.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[#C8BBA2] max-h-[320px] overflow-y-auto pr-1">
            {cart.map((item) => (
              <li key={item.productId} className="py-2.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#1A1917] leading-snug">
                      {item.productName}
                    </p>
                    <p className="text-xs text-[#425264] tabular-nums mt-0.5">
                      {rupiah(item.price)} x {item.quantity} ={" "}
                      <strong className="text-[#143656]">
                        {rupiah(item.price * item.quantity)}
                      </strong>
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => updateQuantity(item.productId, -1)}
                      aria-label={`Kurangi ${item.productName}`}
                      className="inline-flex items-center justify-center min-w-[38px] min-h-[38px] rounded-sm border border-[#143656] bg-white text-[#143656] font-bold hover:bg-[#EAE0C8]"
                    >
                      -
                    </button>
                    <span className="min-w-[22px] text-center text-sm font-extrabold tabular-nums">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateQuantity(item.productId, 1)}
                      aria-label={`Tambah ${item.productName}`}
                      className="inline-flex items-center justify-center min-w-[38px] min-h-[38px] rounded-sm bg-[#143656] text-white font-bold hover:bg-[#0E2740]"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => removeItem(item.productId)}
                      aria-label={`Hapus ${item.productName} dari slip`}
                      className="inline-flex items-center justify-center min-w-[38px] min-h-[38px] rounded-sm border border-[#941F14] text-[#941F14] text-xs font-bold hover:bg-[#FBE9E7] ml-0.5 px-1.5"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor={`note-${item.productId}`} className="sr-only">
                    Catatan untuk {item.productName}
                  </label>
                  <input
                    id={`note-${item.productId}`}
                    type="text"
                    value={item.notes}
                    onChange={(e) => updateItemNotes(item.productId, e.target.value)}
                    placeholder="Catatan gelas (mis. less ice, less sugar)"
                    className="w-full px-2.5 py-1.5 text-xs rounded-sm border border-[#143656]/50 bg-white text-[#1A1917]"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        <div>
          <label
            htmlFor="cart-order-notes"
            className="block text-xs font-bold text-[#143656] mb-1"
          >
            Catatan Pesanan (Opsional)
          </label>
          <input
            id="cart-order-notes"
            type="text"
            value={orderNotes}
            onChange={(e) => setOrderNotes(e.target.value)}
            placeholder="Mis. bungkus / minum di tempat"
            className="field-input text-sm min-h-[40px] py-1.5"
          />
        </div>

        {/* Perforated Tear-Off Total Section */}
        <div className="pt-3.5 border-t-2 border-dashed border-[#143656]/50 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-[#425264]">
            <span>Jumlah Minuman</span>
            <span className="tabular-nums font-bold text-[#1A1917]">{totalItems} item</span>
          </div>
          <div className="flex items-baseline justify-between pt-1">
            <span className="font-display text-xl font-extrabold uppercase text-[#143656]">
              Total Tagihan
            </span>
            <span className="text-2xl font-extrabold text-[#B3281B] tabular-nums">
              {rupiah(total)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <button
            type="button"
            disabled={cart.length === 0}
            onClick={() => onProceedPayment("cash")}
            className="btn-primary w-full"
          >
            Bayar Tunai
          </button>
          <button
            type="button"
            disabled={cart.length === 0}
            onClick={() => onProceedPayment("qris")}
            className="btn-accent w-full"
          >
            Bayar QRIS
          </button>
        </div>
      </div>
    </div>
  );
}
