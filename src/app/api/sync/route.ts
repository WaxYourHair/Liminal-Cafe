import { json, route } from "@/server/api";
import { getSyncQueueOverview, processSyncQueue } from "@/server/syncWorker";

export const GET = route("any", async () => {
  const overview = await getSyncQueueOverview();
  return json(overview);
});

export const POST = route("any", async () => {
  const runResult = await processSyncQueue({ force: true, limit: 50 });
  const overview = await getSyncQueueOverview();
  return json({ runResult, overview });
});
