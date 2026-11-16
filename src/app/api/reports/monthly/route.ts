import { HttpError, json, route } from "@/server/api";
import { getMonthlyReport } from "@/server/repo/orders";
import { jakartaDateKey } from "@/lib/format";

export const GET = route("any", async ({ req }) => {
  const url = new URL(req.url);
  const [defaultYear, defaultMonth] = jakartaDateKey().split("-").map(Number);
  const year = Number(url.searchParams.get("year") ?? defaultYear);
  const month = Number(url.searchParams.get("month") ?? defaultMonth);

  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new HttpError(400, "Tahun tidak valid.");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new HttpError(400, "Bulan harus antara 1 sampai 12.");
  }

  const report = await getMonthlyReport(year, month);
  return json(report);
});
