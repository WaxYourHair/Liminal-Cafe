import { redirect } from "next/navigation";
import { currentUser } from "@/server/session";
import { getCafeName } from "@/server/repo/settings";
import AppShell from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  const cafeName = await getCafeName();
  return (
    <AppShell user={user} cafeName={cafeName}>
      {children}
    </AppShell>
  );
}
