import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getActiveProject, getProjectBundle, type ProjectBundle } from "@/lib/projects";

export function useActiveProjectBundle() {
  const { user } = useAuth();
  const userId = user?.id;

  const active = useQuery({
    queryKey: ["active-project", userId],
    queryFn: () => getActiveProject(userId!),
    enabled: !!userId,
  });

  const projectId = active.data?.id;

  const bundle = useQuery<ProjectBundle>({
    queryKey: ["project-bundle", projectId],
    queryFn: () => getProjectBundle(projectId!),
    enabled: !!projectId,
  });

  return {
    loading: active.isLoading || (!!projectId && bundle.isLoading),
    projectId,
    project: bundle.data?.project ?? active.data ?? null,
    bundle: bundle.data ?? null,
    refetch: () => {
      active.refetch();
      bundle.refetch();
    },
    hasProject: !!active.data,
  };
}
