"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { createProjectAction, updateProjectAction } from "@/lib/actions/projects";
import { projectSchema, type ProjectInput } from "@/lib/validators/project";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function ProjectForm({
  projectId,
  defaultValues,
}: {
  projectId?: string;
  defaultValues: ProjectInput;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const form = useForm<ProjectInput>({
    resolver: zodResolver(projectSchema),
    defaultValues,
  });

  async function onSubmit(values: ProjectInput) {
    setPending(true);
    const result = projectId
      ? await updateProjectAction(projectId, values)
      : await createProjectAction(values);
    setPending(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(projectId ? "Project updated" : "Project created");
    router.push(result.id ? `/app/projects/${result.id}` : "/app/projects");
    router.refresh();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Spring campaign" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea rows={4} placeholder="Optional notes for this library" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : projectId ? "Save project" : "Create project"}
        </Button>
      </form>
    </Form>
  );
}
