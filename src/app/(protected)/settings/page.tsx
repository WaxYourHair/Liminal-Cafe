"use client";

import React, { useCallback, useEffect, useState } from "react";
import { formatDateTime } from "@/lib/format";

interface SettingsPayload {
  user: { id: number; name: string; username: string; role: "admin" | "kasir" };
  cafeName: string;
  qris: { present: boolean; url: string };
  sync: {
    configured: boolean;
    spreadsheetId: string;
    pending: number;
    synced: number;
    failed: number;
    lastSyncedAt: string | null;
    items: {
      id: number;
      orderId: number | null;
      eventKey: string;
      status: "pending" | "synced" | "failed";
      retryCount: number;
      lastError: string | null;
      nextRetryAt: string | null;
      syncedAt: string | null;
      updatedAt: string;
    }[];
  };
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [cafeNameInput, setCafeNameInput] = useState("");
  const [savingCafe, setSavingCafe] = useState(false);

  const [qrisFile, setQrisFile] = useState<File | null>(null);
  const [uploadingQris, setUploadingQris] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [syncingNow, setSyncingNow] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SettingsPayload;
      setData(json);
      setCafeNameInput(json.cafeName);
    } catch {
      setError("Gagal memuat pengaturan aplikasi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  async function handleSaveCafeName(e: React.FormEvent) {
    e.preventDefault();
    setSavingCafe(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cafeName: cafeNameInput.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Gagal menyimpan nama kafe.");
      setNotice("Nama kafe berhasil diperbarui.");
      await loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan nama kafe.");
    } finally {
      setSavingCafe(false);
    }
  }

  async function handleUploadQris(e: React.FormEvent) {
    e.preventDefault();
    if (!qrisFile) return;
    setUploadingQris(true);
    setError(null);
    setNotice(null);
    try {
      const formData = new FormData();
      formData.append("image", qrisFile);
      const res = await fetch("/api/settings", {
        method: "POST",
        body: formData,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Gagal mengunggah gambar QRIS.");
      setQrisFile(null);
      setNotice("Gambar QRIS statis berhasil diperbarui.");
      await loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah gambar QRIS.");
    } finally {
      setUploadingQris(false);
    }
  }

  async function handleDeleteQris() {
    setUploadingQris(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/settings", { method: "DELETE" });
      if (!res.ok) throw new Error("Gagal menghapus gambar QRIS.");
      setNotice("Gambar QRIS dikembalikan ke placeholder default.");
      await loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus gambar QRIS.");
    } finally {
      setUploadingQris(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setSavingPassword(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "change_password",
          currentPassword,
          newPassword,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Gagal mengganti password.");
      setCurrentPassword("");
      setNewPassword("");
      setNotice("Password akun Anda berhasil diperbarui.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengganti password.");
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleSyncNow() {
    setSyncingNow(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Gagal menjalankan sinkronisasi.");
      if (body.runResult?.skipped) {
        setNotice(body.runResult.reason ?? "Sinkronisasi dilewati.");
      } else {
        setNotice(
          `Sinkronisasi selesai: ${body.runResult?.succeeded ?? 0} berhasil, ${
            body.runResult?.failed ?? 0
          } gagal.`,
        );
      }
      await loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menjalankan sinkronisasi.");
    } finally {
      setSyncingNow(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase text-[#143656] leading-none">
          Pengaturan Bar & Sinkronisasi
        </h1>
        <p className="text-sm text-[#425264] mt-1">
          Atur identitas Liminal Campervan Bar, kode QRIS statis, keamanan akun, dan sinkronisasi
          Google Sheets.
        </p>
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
            className="text-xs underline font-extrabold px-2 py-1"
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

      {loading && !data ? (
        <div className="surface-card p-8 text-center text-[#143656] font-bold" role="status">
          Memuat pengaturan...
        </div>
      ) : (
        data && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* Cafe Identity & Static QRIS Upload */}
              <section
                aria-label="Identitas Kafe dan QRIS Statis"
                className="lg:col-span-7 surface-card overflow-hidden"
              >
                <div className="px-5 py-3.5 bg-[#143656] text-[#FAF5EA]">
                  <h2 className="font-display text-xl font-extrabold uppercase leading-none">
                    Identitas Kafe & Gambar QRIS
                  </h2>
                </div>

                <div className="p-5 space-y-5">
                  <form onSubmit={handleSaveCafeName} className="space-y-2">
                    <label
                      htmlFor="setting-cafe-name"
                      className="block text-sm font-bold text-[#143656]"
                    >
                      Nama Kafe
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        id="setting-cafe-name"
                        type="text"
                        required
                        value={cafeNameInput}
                        onChange={(e) => setCafeNameInput(e.target.value)}
                        className="field-input flex-1"
                      />
                      <button type="submit" disabled={savingCafe} className="btn-primary shrink-0">
                        {savingCafe ? "Menyimpan..." : "Simpan Nama"}
                      </button>
                    </div>
                  </form>

                  <div className="pt-4 border-t border-[#C8BBA2] grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
                    <div className="sm:col-span-5 flex flex-col items-center p-3 rounded bg-[#F3EAD8] border border-[#143656]">
                      <img
                        src={data.qris.url}
                        alt="Pratinjau QRIS Statis"
                        width={180}
                        height={210}
                        className="w-44 h-auto rounded object-contain bg-white"
                      />
                      <span className="text-xs font-bold text-[#143656] mt-2">
                        {data.qris.present ? "QRIS Kafe Aktif" : "Placeholder Default"}
                      </span>
                    </div>

                    <form onSubmit={handleUploadQris} className="sm:col-span-7 space-y-3">
                      <div>
                        <label
                          htmlFor="setting-qris-file"
                          className="block text-sm font-bold text-[#143656] mb-1"
                        >
                          Unggah Gambar QRIS Kafe (JPG/PNG/WEBP, maks. 2 MB)
                        </label>
                        <input
                          id="setting-qris-file"
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(e) => setQrisFile(e.target.files?.[0] ?? null)}
                          className="field-input text-xs py-2"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="submit"
                          disabled={!qrisFile || uploadingQris}
                          className="btn-accent text-sm"
                        >
                          {uploadingQris ? "Mengunggah..." : "Unggah QRIS Baru"}
                        </button>

                        {data.qris.present && (
                          <button
                            type="button"
                            disabled={uploadingQris}
                            onClick={handleDeleteQris}
                            className="btn-danger text-sm"
                          >
                            Reset ke Placeholder
                          </button>
                        )}
                      </div>
                    </form>
                  </div>
                </div>
              </section>

              {/* Change Password */}
              <section
                aria-label="Ganti Password"
                className="lg:col-span-5 surface-card overflow-hidden"
              >
                <div className="px-5 py-3.5 bg-[#143656] text-[#FAF5EA]">
                  <h2 className="font-display text-xl font-extrabold uppercase leading-none">
                    Ubah Password Sesi ({data.user.username})
                  </h2>
                </div>

                <form onSubmit={handleChangePassword} className="p-5 space-y-3.5">
                  <div>
                    <label
                      htmlFor="current-password"
                      className="block text-sm font-bold text-[#143656] mb-1"
                    >
                      Password Saat Ini
                    </label>
                    <input
                      id="current-password"
                      type="password"
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="field-input"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="new-password"
                      className="block text-sm font-bold text-[#143656] mb-1"
                    >
                      Password Baru (Minimal 6 Karakter)
                    </label>
                    <input
                      id="new-password"
                      type="password"
                      required
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="field-input"
                    />
                  </div>
                  <button type="submit" disabled={savingPassword} className="btn-primary w-full">
                    {savingPassword ? "Memperbarui..." : "Perbarui Password"}
                  </button>
                </form>
              </section>
            </div>

            {/* Google Sheets Synchronization Queue Inspector */}
            <section
              aria-label="Antrean Sinkronisasi Google Sheets"
              className="surface-card overflow-hidden"
            >
              <div className="px-5 py-3.5 bg-[#143656] text-[#FAF5EA] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-extrabold uppercase leading-none">
                    Antrean Sinkronisasi Google Sheets
                  </h2>
                  <p className="text-xs text-[#F3EAD8]/80 mt-0.5">
                    Tab: Pesanan, Detail Pesanan, Rekap Harian, Rekap Bulanan
                  </p>
                </div>

                <button
                  type="button"
                  disabled={syncingNow}
                  onClick={handleSyncNow}
                  className="btn-accent text-xs py-2 px-3.5 self-start sm:self-auto"
                >
                  {syncingNow ? "Menyinkronkan..." : "Sinkronkan Sekarang"}
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div className="p-3 rounded bg-[#F3EAD8] border border-[#143656]">
                    <span className="text-xs font-bold text-[#425264] block">
                      Status Kredensial
                    </span>
                    <span className="font-extrabold text-[#143656]">
                      {data.sync.configured ? "Aktif" : "Mode Lokal"}
                    </span>
                  </div>
                  <div className="p-3 rounded bg-[#F3EAD8] border border-[#143656]">
                    <span className="text-xs font-bold text-[#425264] block">
                      Menunggu (Pending)
                    </span>
                    <span className="text-lg font-extrabold tabular-nums text-[#143656]">
                      {data.sync.pending}
                    </span>
                  </div>
                  <div className="p-3 rounded bg-[#E5F3EB] border border-[#175E38]">
                    <span className="text-xs font-bold text-[#175E38] block">
                      Terkirim (Synced)
                    </span>
                    <span className="text-lg font-extrabold tabular-nums text-[#175E38]">
                      {data.sync.synced}
                    </span>
                  </div>
                  <div className="p-3 rounded bg-[#FBE9E7] border border-[#941F14]">
                    <span className="text-xs font-bold text-[#941F14] block">
                      Tertunda Error (Failed)
                    </span>
                    <span className="text-lg font-extrabold tabular-nums text-[#941F14]">
                      {data.sync.failed}
                    </span>
                  </div>
                </div>

                {data.sync.items.length === 0 ? (
                  <p className="text-sm font-semibold text-[#425264] py-4 text-center">
                    Belum ada item di antrean sinkronisasi (`sync_queue`).
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="border-b-2 border-[#143656] bg-[#F3EAD8] text-xs font-bold text-[#143656]">
                          <th className="py-2.5 px-3">Event Key</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3">Percobaan</th>
                          <th className="py-2.5 px-3">Waktu Terkirim</th>
                          <th className="py-2.5 px-3">Catatan Error Terakhir</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#C8BBA2]">
                        {data.sync.items.map((item) => (
                          <tr key={item.id}>
                            <td className="py-2.5 px-3 font-bold tabular-nums text-[#143656]">
                              {item.eventKey}
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`inline-block px-2 py-0.5 rounded-sm text-xs font-bold ${
                                  item.status === "synced"
                                    ? "bg-[#E5F3EB] text-[#175E38]"
                                    : item.status === "failed"
                                    ? "bg-[#FBE9E7] text-[#941F14]"
                                    : "bg-[#EAE0C8] text-[#143656]"
                                }`}
                              >
                                {item.status}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 tabular-nums font-semibold">
                              {item.retryCount}x
                            </td>
                            <td className="py-2.5 px-3 text-xs text-[#425264] tabular-nums">
                              {item.syncedAt ? formatDateTime(item.syncedAt) : "-"}
                            </td>
                            <td className="py-2.5 px-3 text-xs text-[#941F14]">
                              {item.lastError || "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          </div>
        )
      )}
    </div>
  );
}
