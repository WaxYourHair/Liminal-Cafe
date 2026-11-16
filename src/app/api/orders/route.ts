import { HttpError, json, route } from "@/server/api";
import { isValidDateKey } from "@/server/time";
import { approveAndCreateOrder, listOrders } from "@/server/repo/orders";
import { processSyncQueue } from "@/server/syncWorker";
import { createOrderOpSchema } from "@/lib/schemas";

export const GET = route("any", async ({ req }) => {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  if (statusParam && statusParam !== "pending" && statusParam !== "selesai") {
    throw new HttpError(400, "Status pesanan hanya boleh 'pending' atau 'selesai'.");
  }
  const q = url.searchParams.get("q")?.trim() || undefined;
  const dateParam = url.searchParams.get("date")?.trim() || undefined;
  if (dateParam && !isValidDateKey(dateParam)) {
    throw new HttpError(400, "Format tanggal tidak valid (gunakan YYYY-MM-DD).");
  }

  const orders = await listOrders({
    status: (statusParam as "pending" | "selesai" | null) ?? undefined,
    q,
    dateKey: dateParam,
  });
  return json({ orders });
});

export const POST = route("any", async ({ req, user }) => {
  const body = await req.json();
  const op = createOrderOpSchema.parse({
    ...body,
    type: "create",
    userId: body.userId ?? user.id,
  });

  const result = await approveAndCreateOrder(op, user.id);

  // Fire-and-forget Google Sheets synchronization so it never blocks the cashier.
  processSyncQueue().catch((err) => {
    console.error("[orders/post] background sync error:", err);
  });

  return json(result, result.duplicate ? 200 : 201);
});
