export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SYNC_WORKER_ENABLED !== "false") {
    const cron = await import("node-cron");
    const { processSyncQueue } = await import("./server/syncWorker");
    // Run every minute to flush any pending or retryable Google Sheets sync items.
    cron.default.schedule("* * * * *", () => {
      processSyncQueue().catch((err) => {
        console.error("[sync-worker] cron error:", err);
      });
    });
  }
}
