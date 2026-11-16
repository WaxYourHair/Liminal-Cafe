import { json, route } from "@/server/api";
import { getDashboardData } from "@/server/repo/orders";

export const GET = route("any", async () => {
  const data = await getDashboardData();
  return json(data);
});
