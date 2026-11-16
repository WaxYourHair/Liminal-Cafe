import bcrypt from "bcryptjs";
import { z } from "zod";
import { exec, queryOne } from "@/server/db";
import { HttpError, json, route } from "@/server/api";
import { getCafeName, hasQris, setBinarySetting, setSetting } from "@/server/repo/settings";
import { getSyncQueueOverview } from "@/server/syncWorker";
import { readImageUpload } from "@/server/upload";
import { passwordSchema } from "@/lib/schemas";

export const GET = route("any", async ({ user }) => {
  const [cafeName, qris, sync] = await Promise.all([
    getCafeName(),
    hasQris(),
    getSyncQueueOverview(),
  ]);
  return json({
    user,
    cafeName,
    qris: {
      present: qris.present,
      url: qris.present ? `/api/images/qris?v=${qris.updatedAt?.getTime() ?? 1}` : "/qris-default.svg",
    },
    sync,
  });
});

export const PUT = route("any", async ({ req, user }) => {
  const body = await req.json();
  if (body?.action === "change_password") {
    const { currentPassword, newPassword } = passwordSchema.parse(body);
    const row = await queryOne<{ password: string }>("SELECT password FROM users WHERE id = ?", [
      user.id,
    ]);
    if (!row || !(await bcrypt.compare(currentPassword, row.password))) {
      throw new HttpError(422, "Password lama tidak sesuai.");
    }
    const hashed = await bcrypt.hash(newPassword, 12);
    await exec("UPDATE users SET password = ? WHERE id = ?", [hashed, user.id]);
    return json({ ok: true, message: "Password berhasil diperbarui." });
  }

  const { cafeName } = z
    .object({ cafeName: z.string().trim().min(2, "Nama kafe minimal 2 karakter.").max(80) })
    .parse(body);
  await setSetting("cafe_name", cafeName);
  return json({ ok: true, cafeName });
});

export const POST = route("any", async ({ req }) => {
  const form = await req.formData();
  const { data, mime } = await readImageUpload(form, "image");
  await setBinarySetting("qris_image", data, mime);
  const qris = await hasQris();
  return json({
    qris: {
      present: qris.present,
      url: `/api/images/qris?v=${qris.updatedAt?.getTime() ?? Date.now()}`,
    },
  });
});

export const DELETE = route("any", async () => {
  await setBinarySetting("qris_image", null, null);
  return json({
    qris: {
      present: false,
      url: "/qris-default.svg",
    },
  });
});
