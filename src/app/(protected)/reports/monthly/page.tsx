import { redirect } from "next/navigation";
import { currentUser } from "@/server/session";
import ReportsView from "@/components/ReportsView";

export default async function MonthlyReportPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <ReportsView initialTab="monthly" />;
}
