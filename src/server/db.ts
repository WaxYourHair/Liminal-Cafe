import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import mysql, { type Pool, type PoolConnection, type PoolOptions } from "mysql2/promise";
import { bootstrapDatabaseIfEmpty } from "./bootstrap";

declare global {
  // Reuse the pool across hot reloads in development.
  var __cvPool: Pool | undefined;
  var __cvMysqlStarting: Promise<void> | undefined;
  var __cvBootstrapping: Promise<void> | undefined;
}

function buildConfig(): PoolOptions {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const needsSsl =
    process.env.DB_SSL === "true" ||
    dbUrl.includes("tidbcloud.com") ||
    dbUrl.includes("aivencloud.com") ||
    dbUrl.includes("psdb.cloud") ||
    dbUrl.includes("ssl=");
  const ssl = needsSsl ? { minVersion: "TLSv1.2" as const, rejectUnauthorized: true } : undefined;
  const common: PoolOptions = {
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_SIZE ?? 10),
    // All DATETIME values are written and read as UTC.
    timezone: "Z",
    dateStrings: false,
    supportBigNumbers: true,
    decimalNumbers: true,
    charset: "utf8mb4",
    ssl,
  };
  if (dbUrl) {
    const cleanUri = dbUrl.replace(/[?&]ssl-mode=[^&]+/gi, "").replace(/[?&]sslaccept=[^&]+/gi, "");
    return { ...common, uri: cleanUri };
  }
  return {
    ...common,
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME ?? "campervan_cafe",
  };
}

function isPortListening(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(600);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

/**
 * Automatically starts the local MySQL 8 instance on port 3307 when running
 * on Windows so `npm run dev` or `npm run start` works without manually starting mysqld.
 */
async function ensureLocalMysqlRunning(): Promise<void> {
  if (process.platform !== "win32" || process.env.DATABASE_URL) return;
  const host = process.env.DB_HOST ?? "127.0.0.1";
  const port = Number(process.env.DB_PORT ?? 3306);
  if ((host !== "127.0.0.1" && host !== "localhost") || port !== 3307) return;

  if (await isPortListening("127.0.0.1", port)) return;

  if (!globalThis.__cvMysqlStarting) {
    globalThis.__cvMysqlStarting = (async () => {
      try {
        const localAppData = process.env.LOCALAPPDATA;
        const mysqldExe = "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe";
        if (!localAppData || !fs.existsSync(/*turbopackIgnore: true*/ mysqldExe)) return;

        const baseDir = path.join(/*turbopackIgnore: true*/ localAppData, "campervan-mysql-dev");
        const dataDir = path.join(/*turbopackIgnore: true*/ baseDir, "data");
        const logFile = path.join(/*turbopackIgnore: true*/ baseDir, "error.log");
        if (!fs.existsSync(/*turbopackIgnore: true*/ dataDir)) return;

        const child = spawn(
          mysqldExe,
          [
            "--no-defaults",
            `--datadir=${dataDir}`,
            `--port=${port}`,
            "--mysqlx=0",
            `--log-error=${logFile}`,
          ],
          {
            cwd: baseDir,
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          },
        );
        child.unref();

        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 300));
          if (await isPortListening("127.0.0.1", port)) break;
        }
      } finally {
        globalThis.__cvMysqlStarting = undefined;
      }
    })();
  }

  await globalThis.__cvMysqlStarting;
}

function isConnRefused(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ECONNREFUSED"
  );
}

function isNoSuchTable(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ER_NO_SUCH_TABLE"
  );
}

async function ensureBootstrapped(): Promise<void> {
  if (!globalThis.__cvBootstrapping) {
    globalThis.__cvBootstrapping = bootstrapDatabaseIfEmpty(getPool()).finally(() => {
      globalThis.__cvBootstrapping = undefined;
    });
  }
  await globalThis.__cvBootstrapping;
}

export function getPool(): Pool {
  if (!globalThis.__cvPool) {
    const pool = mysql.createPool(buildConfig());
    pool.on("connection", (conn) => {
      conn.query("SET time_zone = '+00:00'");
    });
    globalThis.__cvPool = pool;
  }
  return globalThis.__cvPool;
}

type Params = (string | number | boolean | null | Date | Buffer)[];

export async function query<T = Record<string, unknown>>(sql: string, params: Params = []): Promise<T[]> {
  try {
    const [rows] = await getPool().execute(sql, params);
    return rows as T[];
  } catch (err) {
    if (isConnRefused(err)) {
      await ensureLocalMysqlRunning();
      const [rows] = await getPool().execute(sql, params);
      return rows as T[];
    }
    if (isNoSuchTable(err)) {
      await ensureBootstrapped();
      const [rows] = await getPool().execute(sql, params);
      return rows as T[];
    }
    throw err;
  }
}

export async function queryOne<T = Record<string, unknown>>(sql: string, params: Params = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function exec(sql: string, params: Params = []) {
  try {
    const [res] = await getPool().execute(sql, params);
    return res as mysql.ResultSetHeader;
  } catch (err) {
    if (isConnRefused(err)) {
      await ensureLocalMysqlRunning();
      const [res] = await getPool().execute(sql, params);
      return res as mysql.ResultSetHeader;
    }
    if (isNoSuchTable(err)) {
      await ensureBootstrapped();
      const [res] = await getPool().execute(sql, params);
      return res as mysql.ResultSetHeader;
    }
    throw err;
  }
}

/** Runs fn inside one MySQL transaction; any thrown error rolls everything back. */
export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  let conn: PoolConnection;
  try {
    conn = await getPool().getConnection();
  } catch (err) {
    if (isConnRefused(err)) {
      await ensureLocalMysqlRunning();
      conn = await getPool().getConnection();
    } else {
      throw err;
    }
  }
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
