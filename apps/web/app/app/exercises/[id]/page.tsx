import { ExerciseRunner } from "./ExerciseRunner";
import "./exercise-runner.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "练习" };

export default async function ExerciseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ExerciseRunner exerciseSetId={id} />;
}
