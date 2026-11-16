import { HttpError, json, route } from "@/server/api";
import { isValidDateKey } from "@/server/time";
import { getDailyReport } from "@/server/repo/orders";
import { jakartaDateKey } from "@/lib/format";

export const GET = route("any", async ({ req }) => {
  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date")?.trim() || jakartaDateKey();
  if (!isValidDateKey(dateParam)) {
    throw new HttpError(400, "Format tanggal tidak valid (gunakan YYYY-MM-DD).");
  }
  const report = await getDailyReport(dateParam);
  return json(report);
});
