"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { rupiah } from "@/lib/format";
import type { CategoryRow, ProductRow } from "@/server/repo/catalog";

export default function CatalogManager({
  initialSection = "products",
}: {
  initialSection?: "products" | "categories";
}) {
  const [section, setSection] = useState<"products" | "categories">(initialSection);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState<number | "all">("all");

  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [prodName, setProdName] = useState("");
  const [prodCategoryId, setProdCategoryId] = useState<number>(0);
  const [prodPrice, setProdPrice] = useState("");
  const [prodDescription, setProdDescription] = useState("");
  const [prodActive, setProdActive] = useState(true);
  const [prodImageFile, setProdImageFile] = useState<File | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);

  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryRow | null>(null);
  const [catName, setCatName] = useState("");
  const [catDescription, setCatDescription] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catRes, prodRes] = await Promise.all([
        fetch("/api/categories", { cache: "no-store" }),
        fetch("/api/products", { cache: "no-store" }),
      ]);
      if (!catRes.ok || !prodRes.ok) throw new Error("Gagal memuat data katalog.");
      const catJson = (await catRes.json()) as { categories: CategoryRow[] };
      const prodJson = (await prodRes.json()) as { products: ProductRow[] };
      setCategories(catJson.categories);
      setProducts(prodJson.products);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat data katalog.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (filterCategoryId !== "all" && p.category_id !== filterCategoryId) return false;
      if (
        q &&
        !p.name.toLowerCase().includes(q) &&
        !(p.description ?? "").toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [products, searchQuery, filterCategoryId]);

  function openNewProductModal() {
    setEditingProduct(null);
    setProdName("");
    setProdCategoryId(categories[0]?.id ?? 0);
    setProdPrice("15000");
    setProdDescription("");
    setProdActive(true);
    setProdImageFile(null);
    setError(null);
    setProductModalOpen(true);
  }

  function openEditProductModal(product: ProductRow) {
    setEditingProduct(product);
    setProdName(product.name);
    setProdCategoryId(product.category_id);
    setProdPrice(String(product.price));
    setProdDescription(product.description ?? "");
    setProdActive(Boolean(product.is_active));
    setProdImageFile(null);
    setError(null);
    setProductModalOpen(true);
  }

  async function handleSaveProduct(e: React.FormEvent) {
    e.preventDefault();
    setSavingProduct(true);
    setError(null);
    setNotice(null);

    try {
      const payload = {
        categoryId: Number(prodCategoryId),
        name: prodName.trim(),
        description: prodDescription.trim() || null,
        price: Number(prodPrice.replace(/[^\d]/g, "")),
        isActive: prodActive,
      };

      const res = await fetch(
        editingProduct ? `/api/products/${editingProduct.id}` : "/api/products",
        {
          method: editingProduct ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Gagal menyimpan produk.");
      }

      const savedId = editingProduct ? editingProduct.id : body.product?.id;
      if (prodImageFile && savedId) {
        const formData = new FormData();
        formData.append("image", prodImageFile);
        const imgRes = await fetch(`/api/products/${savedId}/image`, {
          method: "POST",
          body: formData,
        });
        if (!imgRes.ok) {
          const imgErr = await imgRes.json().catch(() => ({}));
          throw new Error(imgErr.error ?? "Produk tersimpan, namun gagal mengunggah gambar.");
        }
      }

      setProductModalOpen(false);
      setNotice(
        editingProduct
          ? `Produk "${payload.name}" berhasil diperbarui.`
          : `Produk "${payload.name}" berhasil ditambahkan.`,
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan produk.");
    } finally {
      setSavingProduct(false);
    }
  }

  async function handleToggleActive(product: ProductRow) {
    setError(null);
    setNotice(null);
    try {
      const nextActive = !product.is_active;
      const res = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Gagal mengubah status produk.");
      }
      setNotice(`Produk "${product.name}" kini ${nextActive ? "Aktif" : "Nonaktif (Habis)"}.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengubah status produk.");
    }
  }

  async function handleDeleteProduct(product: ProductRow) {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/products/${product.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Gagal menghapus produk.");
      }
      setNotice(
        body.outcome === "deactivated"
          ? `Produk "${product.name}" sudah memiliki riwayat transaksi sehingga dinonaktifkan (soft-deactivation) agar riwayat penjualan tetap utuh.`
          : `Produk "${product.name}" berhasil dihapus.`,
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus produk.");
    }
  }

  function openNewCategoryModal() {
    setEditingCategory(null);
    setCatName("");
    setCatDescription("");
    setError(null);
    setCategoryModalOpen(true);
  }

  function openEditCategoryModal(category: CategoryRow) {
    setEditingCategory(category);
    setCatName(category.name);
    setCatDescription(category.description ?? "");
    setError(null);
    setCategoryModalOpen(true);
  }

  async function handleSaveCategory(e: React.FormEvent) {
    e.preventDefault();
    setSavingCategory(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        name: catName.trim(),
        description: catDescription.trim() || null,
      };
      const res = await fetch(
        editingCategory ? `/api/categories/${editingCategory.id}` : "/api/categories",
        {
          method: editingCategory ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Gagal menyimpan kategori.");
      }
      setCategoryModalOpen(false);
      setNotice(
        editingCategory
          ? `Kategori "${payload.name}" berhasil diperbarui.`
          : `Kategori "${payload.name}" berhasil ditambahkan.`,
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan kategori.");
    } finally {
      setSavingCategory(false);
    }
  }

  async function handleDeleteCategory(category: CategoryRow) {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/categories/${category.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Gagal menghapus kategori.");
      }
      setNotice(`Kategori "${category.name}" berhasil dihapus.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus kategori.");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold uppercase text-[#143656] leading-none">
            Manajemen Menu & Harga
          </h1>
          <p className="text-sm text-[#425264] mt-1">
            Nonaktifkan menu yang sedang habis, sesuaikan harga, atau tambah minuman baru.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={openNewCategoryModal} className="btn-secondary text-sm">
            + Tambah Kategori
          </button>
          <button type="button" onClick={openNewProductModal} className="btn-accent text-sm">
            + Tambah Produk
          </button>
        </div>
      </div>

      {/* Section Switcher */}
      <div className="inline-flex bg-[#143656] p-1 rounded border-2 border-[#0E2740] gap-1">
        <Link
          href="/menu"
          onClick={(e) => {
            e.preventDefault();
            setSection("products");
          }}
          className={`px-4 py-2 rounded-sm text-sm font-bold min-h-[40px] flex items-center ${
            section === "products"
              ? "bg-[#B3281B] text-white"
              : "text-[#FAF5EA] hover:bg-[#1C466E]"
          }`}
        >
          Daftar Produk ({products.length})
        </Link>
        <Link
          href="/categories"
          onClick={(e) => {
            e.preventDefault();
            setSection("categories");
          }}
          className={`px-4 py-2 rounded-sm text-sm font-bold min-h-[40px] flex items-center ${
            section === "categories"
              ? "bg-[#B3281B] text-white"
              : "text-[#FAF5EA] hover:bg-[#1C466E]"
          }`}
        >
          Daftar Kategori ({categories.length})
        </Link>
      </div>

      {notice && (
        <div
          role="status"
          className="p-3.5 rounded bg-[#E5F3EB] border-2 border-[#175E38] text-[#175E38] text-sm font-bold flex items-center justify-between gap-2"
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs underline font-extrabold px-2"
          >
            Tutup
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded bg-[#FBE9E7] border-2 border-[#941F14] text-[#941F14] text-sm font-bold"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="surface-card p-8 text-center text-[#143656] font-bold" role="status">
          Memuat daftar menu...
        </div>
      ) : section === "products" ? (
        <div className="space-y-4">
          {/* Search & Category Filter */}
          <div className="surface-card p-3.5 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-7">
              <label
                htmlFor="admin-product-search"
                className="block text-xs font-bold text-[#143656] mb-1"
              >
                Cari Minuman
              </label>
              <input
                id="admin-product-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Ketik nama minuman..."
                className="field-input text-sm"
              />
            </div>

            <div className="sm:col-span-5">
              <label
                htmlFor="admin-category-filter"
                className="block text-xs font-bold text-[#143656] mb-1"
              >
                Filter Kategori
              </label>
              <select
                id="admin-category-filter"
                value={filterCategoryId}
                onChange={(e) =>
                  setFilterCategoryId(e.target.value === "all" ? "all" : Number(e.target.value))
                }
                className="field-input text-sm"
              >
                <option value="all">Semua Kategori</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.product_count})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="surface-card overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-[#143656] bg-[#143656] text-xs font-bold text-[#FAF5EA]">
                  <th className="py-3 px-4">Minuman</th>
                  <th className="py-3 px-3">Kategori</th>
                  <th className="py-3 px-3">Harga</th>
                  <th className="py-3 px-3">Ketersediaan</th>
                  <th className="py-3 px-4 text-right">Aksi Cepat Bar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#C8BBA2]">
                {filteredProducts.map((p) => (
                  <tr
                    key={p.id}
                    className={!p.is_active ? "bg-[#EAE0C8]/70" : "hover:bg-[#F3EAD8]/50"}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-sm bg-[#EAE0C8] border border-[#143656] shrink-0 overflow-hidden flex items-center justify-center">
                          {p.image ? (
                            <img
                              src={
                                p.image.startsWith("/api/")
                                  ? `${p.image}?v=${new Date(p.updated_at).getTime()}`
                                  : p.image
                              }
                              alt={p.name}
                              width={48}
                              height={48}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-xs font-bold text-[#143656]">
                              {p.name.slice(0, 2).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div>
                          <p className="font-bold text-[#1A1917]">{p.name}</p>
                          {p.description && (
                            <p className="text-xs text-[#425264] max-w-md">{p.description}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 font-semibold text-[#143656]">{p.category_name}</td>
                    <td className="py-3 px-3 font-extrabold tabular-nums text-[#B3281B]">
                      {rupiah(p.price)}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-sm text-xs font-bold ${
                          p.is_active
                            ? "bg-[#E5F3EB] text-[#175E38]"
                            : "bg-[#FBE9E7] text-[#941F14]"
                        }`}
                      >
                        {p.is_active ? "Tersedia (Aktif)" : "Habis (Nonaktif)"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(p)}
                          className={`text-xs py-1.5 px-3 min-h-[40px] rounded-sm font-bold border-2 border-[#143656] ${
                            p.is_active
                              ? "bg-white text-[#143656] hover:bg-[#EAE0C8]"
                              : "bg-[#175E38] text-white hover:brightness-95"
                          }`}
                        >
                          {p.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditProductModal(p)}
                          className="btn-secondary text-xs py-1.5 px-3 min-h-[40px]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteProduct(p)}
                          aria-label={`Hapus ${p.name}`}
                          className="btn-danger text-xs py-1.5 px-3 min-h-[40px]"
                        >
                          Hapus
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="surface-card overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-[#143656] bg-[#143656] text-xs font-bold text-[#FAF5EA]">
                <th className="py-3 px-4">Nama Kategori</th>
                <th className="py-3 px-3">Keterangan</th>
                <th className="py-3 px-3">Jumlah Produk</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#C8BBA2]">
              {categories.map((cat) => (
                <tr key={cat.id} className="hover:bg-[#F3EAD8]/50">
                  <td className="py-3 px-4 font-bold text-[#143656]">{cat.name}</td>
                  <td className="py-3 px-3 text-[#425264]">{cat.description || "-"}</td>
                  <td className="py-3 px-3 font-bold tabular-nums">{cat.product_count} produk</td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEditCategoryModal(cat)}
                        className="btn-secondary text-xs py-1.5 px-3 min-h-[40px]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={cat.product_count > 0}
                        title={
                          cat.product_count > 0
                            ? "Kategori tidak bisa dihapus selama masih memiliki produk"
                            : "Hapus kategori"
                        }
                        onClick={() => handleDeleteCategory(cat)}
                        className="btn-danger text-xs py-1.5 px-3 min-h-[40px]"
                      >
                        Hapus
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Product Modal */}
      {productModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => !savingProduct && setProductModalOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-modal-title"
            className="relative z-10 w-full max-w-lg modal-elevated max-h-[92dvh] overflow-y-auto"
          >
            <div className="flex items-center justify-between px-5 py-3.5 bg-[#143656] text-[#FAF5EA] border-b-2 border-[#0E2740]">
              <h2
                id="product-modal-title"
                className="font-display text-xl font-extrabold uppercase"
              >
                {editingProduct ? `Edit Produk: ${editingProduct.name}` : "Tambah Produk Baru"}
              </h2>
              <button
                type="button"
                onClick={() => setProductModalOpen(false)}
                aria-label="Tutup form produk"
                className="min-w-[44px] min-h-[40px] px-3 rounded bg-[#0E2740] text-white text-xs font-bold border border-[#FAF5EA]/30"
              >
                Tutup
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="p-5 space-y-4">
              <div>
                <label htmlFor="prod-name" className="block text-sm font-bold text-[#143656] mb-1">
                  Nama Produk
                </label>
                <input
                  id="prod-name"
                  type="text"
                  required
                  value={prodName}
                  onChange={(e) => setProdName(e.target.value)}
                  placeholder="Contoh: Iced Palm Sugar Latte"
                  className="field-input"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="prod-category"
                    className="block text-sm font-bold text-[#143656] mb-1"
                  >
                    Kategori
                  </label>
                  <select
                    id="prod-category"
                    required
                    value={prodCategoryId}
                    onChange={(e) => setProdCategoryId(Number(e.target.value))}
                    className="field-input"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="prod-price"
                    className="block text-sm font-bold text-[#143656] mb-1"
                  >
                    Harga (Rp)
                  </label>
                  <input
                    id="prod-price"
                    type="number"
                    min={0}
                    step={500}
                    required
                    value={prodPrice}
                    onChange={(e) => setProdPrice(e.target.value)}
                    className="field-input tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="prod-description"
                  className="block text-sm font-bold text-[#143656] mb-1"
                >
                  Deskripsi Rasa / Komposisi (Opsional)
                </label>
                <textarea
                  id="prod-description"
                  rows={2}
                  value={prodDescription}
                  onChange={(e) => setProdDescription(e.target.value)}
                  placeholder="Komposisi atau karakter rasa minuman"
                  className="field-input"
                />
              </div>

              <div>
                <label
                  htmlFor="prod-image"
                  className="block text-sm font-bold text-[#143656] mb-1"
                >
                  Ganti Foto Produk (JPG/PNG/WEBP, maks. 2 MB)
                </label>
                <input
                  id="prod-image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => setProdImageFile(e.target.files?.[0] ?? null)}
                  className="field-input text-xs py-2"
                />
              </div>

              <label htmlFor="prod-active" className="flex items-center gap-2.5">
                <input
                  id="prod-active"
                  type="checkbox"
                  checked={prodActive}
                  onChange={(e) => setProdActive(e.target.checked)}
                  className="w-5 h-5 accent-[#B3281B]"
                />
                <span className="text-sm font-bold text-[#1A1917]">
                  Tampilkan sebagai menu tersedia di halaman kasir
                </span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#C8BBA2]">
                <button
                  type="button"
                  disabled={savingProduct}
                  onClick={() => setProductModalOpen(false)}
                  className="btn-secondary"
                >
                  Batal
                </button>
                <button type="submit" disabled={savingProduct} className="btn-accent">
                  {savingProduct ? "Menyimpan..." : "Simpan Produk"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Category Modal */}
      {categoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => !savingCategory && setCategoryModalOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-modal-title"
            className="relative z-10 w-full max-w-md modal-elevated"
          >
            <div className="flex items-center justify-between px-5 py-3.5 bg-[#143656] text-[#FAF5EA] border-b-2 border-[#0E2740]">
              <h2
                id="category-modal-title"
                className="font-display text-xl font-extrabold uppercase"
              >
                {editingCategory ? `Edit Kategori: ${editingCategory.name}` : "Tambah Kategori Baru"}
              </h2>
              <button
                type="button"
                onClick={() => setCategoryModalOpen(false)}
                aria-label="Tutup form kategori"
                className="min-w-[44px] min-h-[40px] px-3 rounded bg-[#0E2740] text-white text-xs font-bold border border-[#FAF5EA]/30"
              >
                Tutup
              </button>
            </div>

            <form onSubmit={handleSaveCategory} className="p-5 space-y-4">
              <div>
                <label htmlFor="cat-name" className="block text-sm font-bold text-[#143656] mb-1">
                  Nama Kategori
                </label>
                <input
                  id="cat-name"
                  type="text"
                  required
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder="Contoh: Signature / Manual Brew"
                  className="field-input"
                />
              </div>

              <div>
                <label
                  htmlFor="cat-description"
                  className="block text-sm font-bold text-[#143656] mb-1"
                >
                  Keterangan (Opsional)
                </label>
                <input
                  id="cat-description"
                  type="text"
                  value={catDescription}
                  onChange={(e) => setCatDescription(e.target.value)}
                  placeholder="Keterangan singkat kategori"
                  className="field-input"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#C8BBA2]">
                <button
                  type="button"
                  disabled={savingCategory}
                  onClick={() => setCategoryModalOpen(false)}
                  className="btn-secondary"
                >
                  Batal
                </button>
                <button type="submit" disabled={savingCategory} className="btn-accent">
                  {savingCategory ? "Menyimpan..." : "Simpan Kategori"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
