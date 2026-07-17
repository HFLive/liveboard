import { SubmissionsClient } from "./SubmissionsClient";
import "./review.css";

export default async function ExerciseSubmissionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <SubmissionsClient exerciseSetId={id} />;
}
