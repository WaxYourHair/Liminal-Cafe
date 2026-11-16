import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { currentUser, type Role, type SessionUser } from "./session";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * CSRF guard for state-changing requests: the browser always sends Origin on POST/PUT/PATCH/DELETE
 * from fetch, so a request whose Origin does not match the host is rejected.
 */
function assertSameOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) throw new HttpError(403, "Permintaan ditolak (origin tidak valid).");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Permintaan ditolak (origin tidak valid).");
  }
  if (originHost !== host) throw new HttpError(403, "Permintaan ditolak (origin berbeda).");
}

type Handler<C> = (ctx: { req: NextRequest; user: SessionUser; params: C }) => Promise<Response>;

/** Wraps an API route: CSRF check, authentication, role check and uniform error responses. */
export function route<C = Record<string, string>>(roles: Role[] | "any", handler: Handler<C>) {
  return async (req: NextRequest, ctx: { params: Promise<C> }) => {
    try {
      assertSameOrigin(req);
      const user = await currentUser();
      if (!user) throw new HttpError(401, "Sesi berakhir. Silakan masuk kembali.");
      if (roles !== "any" && !roles.includes(user.role)) {
        throw new HttpError(403, "Anda tidak memiliki akses ke fitur ini.");
      }
      const params = ctx?.params ? await ctx.params : ({} as C);
      return await handler({ req, user, params });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  if (err instanceof ZodError) {
    return json({ error: err.issues[0]?.message ?? "Data tidak valid.", issues: err.issues }, 422);
  }
  const code = (err as { code?: string })?.code;
  if (code === "ER_DUP_ENTRY") return json({ error: "Data dengan nama tersebut sudah ada." }, 409);
  if (code === "ECONNREFUSED" || code === "PROTOCOL_CONNECTION_LOST") {
    return json({ error: "Database tidak dapat dihubungi." }, 503);
  }
  console.error("[api] unexpected error", err);
  return json({ error: "Terjadi kesalahan pada server." }, 500);
}

export function parseId(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "ID tidak valid.");
  return id;
}
