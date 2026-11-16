import { getSession } from "@/server/session";
import { errorResponse, json } from "@/server/api";

export async function POST() {
  try {
    const session = await getSession();
    session.destroy();
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
