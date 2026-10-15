import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ProjectNotFound() {
  return (
    <div className="mx-auto flex min-h-[40vh] w-full max-w-lg flex-col items-start justify-center gap-4">
      <h1 className="text-2xl font-semibold">Project not found</h1>
      <p className="text-muted-foreground">This project does not exist, was deleted, or is not in your account.</p>
      <Button asChild>
        <Link href="/app/projects">Back to projects</Link>
      </Button>
    </div>
  );
}
