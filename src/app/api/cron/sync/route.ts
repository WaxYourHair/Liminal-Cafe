import { NextRequest } from "next/server";
import { errorResponse, HttpError, json } from "@/server/api";
import { processSyncQueue } from "@/server/syncWorker";

async function handleCron(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET?.trim();
    const auth = req.headers.get("authorization");
    if (!secret || auth !== `Bearer ${secret}`) {
      throw new HttpError(401, "Token cron tidak valid.");
    }
    const result = await processSyncQueue({ limit: 50 });
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

export const GET = handleCron;
export const POST = handleCron;
