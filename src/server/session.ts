import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { queryOne } from "./db";

export type Role = "admin" | "kasir";

export interface SessionUser {
  id: number;
  name: string;
  username: string;
  role: Role;
}

interface SessionData {
  user?: SessionUser;
}

function sessionOptions(): SessionOptions {
  const rawSecret = process.env.SESSION_SECRET;
  const secret =
    rawSecret && rawSecret.length >= 32
      ? rawSecret
      : crypto
          .createHash("sha256")
          .update(rawSecret || process.env.DATABASE_URL || "liminal-campervan-bar-pos-secret")
          .digest("hex");
  const hours = Number(process.env.SESSION_HOURS ?? 14);
  const secure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production";
  return {
    password: secret,
    cookieName: "cv_session",
    ttl: hours * 60 * 60,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
    },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

/** Session user, re-checked against the database so a deactivated account loses access immediately. */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await getSession();
  if (!session.user) return null;
  const row = await queryOne<{ id: number; name: string; username: string; role: Role; is_active: number }>(
    "SELECT id, name, username, role, is_active FROM users WHERE id = ?",
    [session.user.id],
  );
  if (!row || !row.is_active) return null;
  return { id: row.id, name: row.name, username: row.username, role: row.role };
}
