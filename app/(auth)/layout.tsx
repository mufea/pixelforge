import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-[radial-gradient(circle_at_top,_oklch(0.35_0.08_255_/_0.28),_transparent_50%)]">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-6">
        <Brand />
        <ThemeToggle />
      </header>
      <div className="flex flex-1 items-start justify-center px-4 pb-16">{children}</div>
    </div>
  );
}
