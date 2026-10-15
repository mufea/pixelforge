"use client";

import { FolderOpen, LayoutDashboard, LogOut, Settings, Shield } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/auth-client";
import { cn } from "@/lib/utils";

const items = [
  { href: "/app", label: "Overview", icon: LayoutDashboard },
  { href: "/app/projects", label: "Projects", icon: FolderOpen },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export function AppNav({
  email,
  role,
}: {
  email: string;
  role: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <aside className="flex w-full flex-col border-b bg-sidebar md:h-screen md:w-64 md:border-r md:border-b-0">
      <div className="flex items-center justify-between px-4 py-4">
        <Brand href="/app" />
        <ThemeToggle />
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible" aria-label="Workspace">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              (item.href === "/app" ? pathname === "/app" : pathname === item.href || pathname.startsWith(`${item.href}/`)) &&
                "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
          >
            <item.icon className="size-4" />
            {item.label}
          </Link>
        ))}
        {role === "admin" ? (
          <Link
            href="/admin"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Shield className="size-4" />
            Admin
          </Link>
        ) : null}
      </nav>
      <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
        <p className="truncate text-xs text-muted-foreground">{email}</p>
        <Button type="button" variant="ghost" size="icon" aria-label="Sign out" onClick={signOut}>
          <LogOut className="size-4" />
        </Button>
      </div>
    </aside>
  );
}
