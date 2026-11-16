import { json, route } from "@/server/api";
import { listCategories, listProducts } from "@/server/repo/catalog";
import { getCafeName, hasQris } from "@/server/repo/settings";
import { getNextOrderSequence } from "@/server/repo/orders";
import { jakartaDateKey } from "@/lib/format";

export const GET = route("any", async ({ user }) => {
  const [categories, products, cafeName, qris] = await Promise.all([
    listCategories(),
    listProducts({ activeOnly: true }),
    getCafeName(),
    hasQris(),
  ]);

  const dateCompact = jakartaDateKey().replace(/-/g, "").slice(2); // YYMMDD
  const nextSeq = await getNextOrderSequence(dateCompact);

  return json({
    user,
    cafeName,
    qris: {
      present: qris.present,
      url: qris.present ? `/api/images/qris?v=${qris.updatedAt?.getTime() ?? 1}` : "/qris-default.svg",
    },
    categories,
    products,
    nextSequence: nextSeq,
  });
});
