/**
 * Database backup and restore utility for Campervan Cafe POS.
 *
 *   npm run db:backup                       -> exports JSON snapshot into backups/
 *   npm run db:backup -- restore <file>     -> restores snapshot into MySQL
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import mysql, { type RowDataPacket } from "mysql2/promise";

const TABLES = [
  "users",
  "categories",
  "products",
  "orders",
  "order_items",
  "payments",
  "sync_queue",
  "settings",
] as const;

async function openConn() {
  const ssl = process.env.DB_SSL === "true" ? { minVersion: "TLSv1.2", rejectUnauthorized: true } : undefined;
  if (process.env.DATABASE_URL) {
    return mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z", ssl });
  }
  return mysql.createConnection({
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME ?? "campervan_cafe",
    timezone: "Z",
    ssl,
  });
}

function serializeRow(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (Buffer.isBuffer(v)) {
      out[k] = { __type: "buffer", data: v.toString("base64") };
    } else if (v instanceof Date) {
      out[k] = { __type: "date", data: v.toISOString() };
    } else {
      out[k] = v;
    }
  }
  return out;
}

function deserializeValue(v: unknown): unknown {
  if (v && typeof v === "object" && "__type" in (v as Record<string, unknown>)) {
    const typed = v as { __type: string; data: string };
    if (typed.__type === "buffer") return Buffer.from(typed.data, "base64");
    if (typed.__type === "date") return new Date(typed.data);
  }
  if (v && typeof v === "object") return JSON.stringify(v);
  return v;
}

export async function createBackup(customOutPath?: string): Promise<string> {
  const conn = await openConn();
  try {
    const dump: Record<string, unknown[]> = {};
    for (const table of TABLES) {
      const [rows] = await conn.query<RowDataPacket[]>(`SELECT * FROM \`${table}\``);
      dump[table] = rows.map((r) => serializeRow(r));
    }

    const dir = path.join(process.cwd(), "backups");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = customOutPath ?? path.join(dir, `campervan_cafe_${stamp}.json`);
    fs.writeFileSync(
      target,
      JSON.stringify({ createdAt: new Date().toISOString(), tables: dump }, null, 2),
      "utf8",
    );
    return target;
  } finally {
    await conn.end();
  }
}

export async function restoreBackup(filePath: string): Promise<void> {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File backup tidak ditemukan: ${resolved}`);
  }
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as {
    tables: Record<string, Record<string, unknown>[]>;
  };

  const conn = await openConn();
  try {
    await conn.beginTransaction();
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");

    for (const table of [...TABLES].reverse()) {
      await conn.query(`DELETE FROM \`${table}\``);
    }

    for (const table of TABLES) {
      const rows = parsed.tables[table] ?? [];
      for (const rawRow of rows) {
        const cols = Object.keys(rawRow);
        const vals = cols.map((c) => deserializeValue(rawRow[c]));
        const placeholders = cols.map(() => "?").join(", ");
        const colNames = cols.map((c) => `\`${c}\``).join(", ");
        await conn.execute(`INSERT INTO \`${table}\` (${colNames}) VALUES (${placeholders})`, vals as (string | number | Buffer | Date | null)[]);
      }
    }

    await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "restore") {
    if (!arg) {
      console.error("Pemakaian: npm run db:backup -- restore <lokasi-file-backup.json>");
      process.exit(1);
    }
    restoreBackup(arg)
      .then(() => console.log(`Restore berhasil dari ${arg}`))
      .catch((err) => {
        console.error("Restore gagal:", err.message);
        process.exit(1);
      });
  } else {
    createBackup(cmd)
      .then((out) => console.log(`Backup tersimpan di: ${out}`))
      .catch((err) => {
        console.error("Backup gagal:", err.message);
        process.exit(1);
      });
  }
}
