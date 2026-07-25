import { NewExerciseClient } from "../../new/NewExerciseClient";
import type { Metadata } from "next";
import "../../new/quiz-builder.css";

export const metadata: Metadata = { title: "编辑练习" };

export default async function EditExercisePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <NewExerciseClient exerciseId={id} />;
}
