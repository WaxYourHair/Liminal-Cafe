import { redirect } from "next/navigation";
import { currentUser } from "@/server/session";
import ReportsView from "@/components/ReportsView";

export default async function ReportsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <ReportsView initialTab="daily" />;
}
