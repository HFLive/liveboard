import { SubmissionsClient } from "./SubmissionsClient";
import "./review.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "批改" };

export default async function ExerciseSubmissionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <SubmissionsClient exerciseSetId={id} />;
}
