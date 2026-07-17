import { ExerciseRunner } from "./ExerciseRunner";
import "./exercise-runner.css";

export default async function ExerciseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ExerciseRunner exerciseSetId={id} />;
}
