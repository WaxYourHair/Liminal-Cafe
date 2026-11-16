import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { queryOne } from "@/server/db";
import { getSession, type Role } from "@/server/session";
import { errorResponse, HttpError, json } from "@/server/api";
import { loginSchema } from "@/lib/schemas";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, password } = loginSchema.parse(body);

    const user = await queryOne<{
      id: number;
      name: string;
      username: string;
      password: string;
      role: Role;
      is_active: number;
    }>("SELECT id, name, username, password, role, is_active FROM users WHERE username = ? LIMIT 1", [
      username,
    ]);

    if (!user || !user.is_active) {
      throw new HttpError(401, "Username atau password salah.");
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      throw new HttpError(401, "Username atau password salah.");
    }

    const session = await getSession();
    session.user = {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
    };
    await session.save();

    return json({ user: session.user });
  } catch (err) {
    return errorResponse(err);
  }
}
