import { json, route } from "@/server/api";
import { approveAndCreateOrder, completeOrderByUuid } from "@/server/repo/orders";
import { processSyncQueue } from "@/server/syncWorker";
import { pushBodySchema, pushOpSchema, type PushResult } from "@/lib/schemas";

export const POST = route("any", async ({ req, user }) => {
  const raw = await req.json();
  const { ops } = pushBodySchema.parse(raw);

  const results: PushResult[] = [];

  for (const rawOp of ops) {
    const parsed = pushOpSchema.safeParse(rawOp);
    if (!parsed.success) {
      const fallbackUuid =
        typeof (rawOp as { clientUuid?: unknown })?.clientUuid === "string"
          ? ((rawOp as { clientUuid: string }).clientUuid)
          : "unknown";
      results.push({
        clientUuid: fallbackUuid,
        type: "create",
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Operasi tidak valid.",
      });
      continue;
    }

    const op = parsed.data;
    try {
      if (op.type === "create") {
        const res = await approveAndCreateOrder(op, user.id);
        results.push({
          clientUuid: op.clientUuid,
          type: "create",
          ok: true,
          duplicate: res.duplicate,
          orderCode: res.orderCode,
        });
      } else {
        const res = await completeOrderByUuid(op.clientUuid, op.completedAt);
        results.push({
          clientUuid: op.clientUuid,
          type: "complete",
          ok: true,
          duplicate: res.duplicate,
          orderCode: res.orderCode,
        });
      }
    } catch (err) {
      results.push({
        clientUuid: op.clientUuid,
        type: op.type,
        ok: false,
        error: err instanceof Error ? err.message : "Gagal memproses operasi.",
      });
    }
  }

  processSyncQueue().catch((err) => {
    console.error("[orders/push] background sync error:", err);
  });

  return json({ results });
});
