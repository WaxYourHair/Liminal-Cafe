import { z } from "zod";
import { json, route } from "@/server/api";
import { completeOrderByUuid } from "@/server/repo/orders";

export const POST = route<{ uuid: string }>("any", async ({ req, params }) => {
  const uuid = z.string().uuid("UUID pesanan tidak valid.").parse(params.uuid);
  let completedAt: string | undefined;
  try {
    const body = await req.json();
    if (body?.completedAt && typeof body.completedAt === "string") {
      completedAt = body.completedAt;
    }
  } catch {
    // Empty body is valid; defaults to server timestamp.
  }

  const result = await completeOrderByUuid(uuid, completedAt);
  return json(result);
});
