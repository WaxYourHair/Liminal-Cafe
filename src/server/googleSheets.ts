import "server-only";
import fs from "node:fs";
import path from "node:path";
import { google, type sheets_v4 } from "googleapis";

export interface SheetDefinition {
  title: "Pesanan" | "Detail Pesanan" | "Rekap Harian" | "Rekap Bulanan";
  headers: string[];
  keyColumns: number[]; // 0-based column indexes that form the unique key
}

export const SHEET_DEFS: Record<SheetDefinition["title"], SheetDefinition> = {
  Pesanan: {
    title: "Pesanan",
    headers: [
      "Order ID",
      "Order Code",
      "Transaction Date",
      "Customer Name",
      "Total",
      "Payment Method",
      "Payment Status",
      "Cashier",
    ],
    keyColumns: [0],
  },
  "Detail Pesanan": {
    title: "Detail Pesanan",
    headers: [
      "Order Item ID",
      "Order Code",
      "Product Name",
      "Quantity",
      "Unit Price",
      "Subtotal",
      "Notes",
    ],
    keyColumns: [0],
  },
  "Rekap Harian": {
    title: "Rekap Harian",
    headers: ["Date", "Order Count", "Cash Revenue", "QRIS Revenue", "Total Revenue"],
    keyColumns: [0],
  },
  "Rekap Bulanan": {
    title: "Rekap Bulanan",
    headers: ["Month", "Year", "Order Count", "Cash Revenue", "QRIS Revenue", "Total Revenue"],
    keyColumns: [0, 1],
  },
};

export function isGoogleSheetsConfigured(): boolean {
  if (process.env.GOOGLE_SHEETS_MOCK_FILE) return true;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) return false;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim()) return true;
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!credPath) return false;
  const resolved = path.isAbsolute(credPath)
    ? credPath
    : path.join(/*turbopackIgnore: true*/ process.cwd(), credPath);
  return fs.existsSync(/*turbopackIgnore: true*/ resolved);
}

function loadCredentials(): { client_email: string; private_key: string } {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  if (b64) {
    const raw = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(raw);
  }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ?? "./credentials/service-account.json";
  const resolved = path.isAbsolute(credPath)
    ? credPath
    : path.join(/*turbopackIgnore: true*/ process.cwd(), credPath);
  if (!fs.existsSync(/*turbopackIgnore: true*/ resolved)) {
    throw new Error(`File kredensial Service Account tidak ditemukan di ${credPath}`);
  }
  return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ resolved, "utf8"));
}

let cachedClient: sheets_v4.Sheets | null = null;

function getSheetsClient(): sheets_v4.Sheets {
  if (cachedClient) return cachedClient;
  const creds = loadCredentials();
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  cachedClient = google.sheets({ version: "v4", auth });
  return cachedClient;
}

function buildKey(row: (string | number)[], keyCols: number[]): string {
  return keyCols.map((idx) => String(row[idx] ?? "").trim()).join("::");
}

/**
 * Local file mock used only when GOOGLE_SHEETS_MOCK_FILE is set (automated verification of
 * retry and idempotent upsert behavior without external network dependency).
 */
function upsertRowsMock(
  mockFile: string,
  def: SheetDefinition,
  rows: (string | number)[][],
) {
  if (process.env.GOOGLE_SHEETS_SIMULATE_OFFLINE === "true") {
    throw new Error("ENOTFOUND sheets.googleapis.com (simulasi jaringan terputus)");
  }
  const store: Record<string, (string | number)[][]> = fs.existsSync(mockFile)
    ? JSON.parse(fs.readFileSync(mockFile, "utf8"))
    : {};
  const existing = store[def.title] ?? [def.headers];
  const dataRows = existing.slice(1);

  for (const incoming of rows) {
    const key = buildKey(incoming, def.keyColumns);
    const foundIdx = dataRows.findIndex((r) => buildKey(r, def.keyColumns) === key);
    if (foundIdx >= 0) {
      dataRows[foundIdx] = incoming;
    } else {
      dataRows.push(incoming);
    }
  }
  store[def.title] = [def.headers, ...dataRows];
  fs.writeFileSync(mockFile, JSON.stringify(store, null, 2), "utf8");
}

let ensuredSpreadsheetId: string | null = null;

async function ensureSheetsExist(sheets: sheets_v4.Sheets, spreadsheetId: string) {
  if (ensuredSpreadsheetId === spreadsheetId) return;
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTitles = new Set(
    (meta.data.sheets ?? []).map((s) => s.properties?.title).filter(Boolean) as string[],
  );

  const requests: sheets_v4.Schema$Request[] = [];
  for (const def of Object.values(SHEET_DEFS)) {
    if (!existingTitles.has(def.title)) {
      requests.push({ addSheet: { properties: { title: def.title } } });
    }
  }
  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }

  for (const def of Object.values(SHEET_DEFS)) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${def.title}'!A1:H1`,
    });
    const firstRow = res.data.values?.[0];
    if (!firstRow || firstRow.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${def.title}'!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [def.headers] },
      });
    }
  }
  ensuredSpreadsheetId = spreadsheetId;
}

/**
 * Idempotently inserts or updates rows in a sheet keyed by `def.keyColumns`.
 * Retries never produce duplicate rows.
 */
export async function upsertSheetRows(
  sheetTitle: SheetDefinition["title"],
  rows: (string | number)[][],
): Promise<void> {
  if (rows.length === 0) return;
  const def = SHEET_DEFS[sheetTitle];
  const mockFile = process.env.GOOGLE_SHEETS_MOCK_FILE?.trim();
  if (mockFile) {
    upsertRowsMock(mockFile, def, rows);
    return;
  }

  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID belum dikonfigurasi di .env");
  }

  const sheets = getSheetsClient();
  await ensureSheetsExist(sheets, spreadsheetId);

  const existingRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${def.title}'!A2:H`,
  });
  const existingRows = existingRes.data.values ?? [];
  const rowIndexByKey = new Map<string, number>();
  existingRows.forEach((r, idx) => {
    const k = buildKey(r, def.keyColumns);
    if (k) rowIndexByKey.set(k, idx + 2); // 1-based sheet row, header is row 1
  });

  const toAppend: (string | number)[][] = [];
  for (const row of rows) {
    const key = buildKey(row, def.keyColumns);
    const sheetRowNumber = rowIndexByKey.get(key);
    if (sheetRowNumber) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${def.title}'!A${sheetRowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [row] },
      });
    } else {
      toAppend.push(row);
    }
  }

  if (toAppend.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${def.title}'!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: toAppend },
    });
  }
}
