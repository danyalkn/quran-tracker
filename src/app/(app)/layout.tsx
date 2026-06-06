import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getAuth, isOnboarded } from "@/lib/auth";
import { TabBar } from "@/components/ui/TabBar";

/** Shell for the authenticated app: gates access, then frames children with
 *  the bottom tab bar. */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured()) redirect("/login");

  const { user, profile } = await getAuth();
  if (!user) redirect("/login");
  if (!isOnboarded(profile)) redirect("/onboarding");

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <TabBar />
    </div>
  );
}
