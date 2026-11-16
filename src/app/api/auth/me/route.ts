import { currentUser } from "@/server/session";
import { json } from "@/server/api";

export async function GET() {
  const user = await currentUser();
  if (!user) return json({ user: null }, 401);
  return json({ user });
}
