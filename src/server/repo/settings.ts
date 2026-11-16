import "server-only";
import { exec, queryOne } from "../db";

export async function getSetting(key: string): Promise<string | null> {
  const row = await queryOne<{ setting_value: string | null }>(
    "SELECT setting_value FROM settings WHERE setting_key = ?",
    [key],
  );
  return row?.setting_value ?? null;
}

export async function setSetting(key: string, value: string | null) {
  await exec(
    `INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, value],
  );
}

export async function getBinarySetting(key: string) {
  return queryOne<{ binary_value: Buffer | null; mime: string | null; updated_at: Date }>(
    "SELECT binary_value, mime, updated_at FROM settings WHERE setting_key = ?",
    [key],
  );
}

export async function setBinarySetting(key: string, data: Buffer | null, mime: string | null) {
  await exec(
    `INSERT INTO settings (setting_key, binary_value, mime) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE binary_value = VALUES(binary_value), mime = VALUES(mime)`,
    [key, data, mime],
  );
}

export async function getCafeName(): Promise<string> {
  try {
    return (await getSetting("cafe_name")) ?? "Liminal Campervan Bar";
  } catch {
    return "Liminal Campervan Bar";
  }
}

export async function hasQris(): Promise<{ present: boolean; updatedAt: Date | null }> {
  const row = await queryOne<{ present: number; updated_at: Date }>(
    "SELECT binary_value IS NOT NULL AS present, updated_at FROM settings WHERE setting_key = 'qris_image'",
  );
  return { present: Boolean(row?.present), updatedAt: row?.updated_at ?? null };
}
