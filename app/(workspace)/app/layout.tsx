import { redirect } from "next/navigation";
import { AppNav } from "@/components/layout/app-nav";
import { getCurrentSession } from "@/lib/auth/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (!session?.user) {
    redirect("/login?next=/app");
  }

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <AppNav email={session.user.email} role={session.user.role ?? "user"} />
      <main className="flex-1 px-4 py-8 md:px-8">{children}</main>
    </div>
  );
}
