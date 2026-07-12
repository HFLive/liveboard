import { ExerciseRunner } from "./ExerciseRunner";

export default async function ExerciseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ExerciseRunner exerciseSetId={id} />;
}
