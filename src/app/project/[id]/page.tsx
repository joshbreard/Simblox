"use client";

import { use } from "react";
import ProjectView from "@/components/ProjectView";

export default function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <ProjectView projectId={id} />;
}
