export default function ProjectsLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="h-8 w-40 animate-pulse rounded-md bg-muted" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-28 animate-pulse rounded-xl bg-muted" />
        <div className="h-28 animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  );
}
