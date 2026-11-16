"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Gagal masuk. Periksa kembali username dan password.");
        return;
      }
      router.push("/pos");
      router.refresh();
    } catch {
      setError("Tidak dapat terhubung ke server. Pastikan jaringan atau server aktif.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-dvh flex flex-col justify-between bg-[#F3EAD8] text-[#1A1917]">
      <div className="checker-strip" aria-hidden="true" />

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md ticket-slip overflow-hidden">
          <div className="px-6 py-4 bg-[#143656] text-[#FAF5EA] border-b-2 border-[#0E2740]">
            <p className="font-display text-2xl font-extrabold uppercase leading-none">
              Liminal Campervan Bar
            </p>
            <p className="text-xs text-[#F3EAD8]/85 mt-1">
              Coffee. Culture. Street. · Sistem Kasir & Bar
            </p>
          </div>

          <div className="p-6 sm:p-7 space-y-5">
            <div className="rounded overflow-hidden border-2 border-[#143656] bg-[#E8D5B5]">
              <img
                src="/logo-banner.jpg"
                alt="Logo Liminal Campervan Bar"
                width={726}
                height={410}
                fetchPriority="high"
                className="w-full h-auto block object-cover"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="p-3.5 rounded bg-[#FBE9E7] border-2 border-[#941F14] text-[#941F14] text-sm font-bold"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label
                  htmlFor="login-username"
                  className="block text-sm font-bold text-[#143656] mb-1.5"
                >
                  Username Kasir
                </label>
                <input
                  id="login-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Ketik username (mis. kasir)"
                  className="field-input"
                />
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="block text-sm font-bold text-[#143656] mb-1.5"
                >
                  Password
                </label>
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan password"
                  className="field-input"
                />
              </div>

              <button type="submit" disabled={submitting} className="btn-accent w-full mt-2 py-3">
                {submitting ? "Memverifikasi..." : "Buka Meja Kasir"}
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="checker-strip" aria-hidden="true" />
    </main>
  );
}
