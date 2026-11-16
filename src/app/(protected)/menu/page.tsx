import { redirect } from "next/navigation";
import { currentUser } from "@/server/session";
import CatalogManager from "@/components/CatalogManager";

export default async function MenuManagementPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <CatalogManager initialSection="products" />;
}
