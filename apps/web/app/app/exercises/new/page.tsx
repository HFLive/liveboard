import { NewExerciseClient } from "./NewExerciseClient";
import type { Metadata } from "next";
import "./quiz-builder.css";

export const metadata: Metadata = { title: "新建练习" };

export default async function NewExercisePage({
  searchParams,
}: {
  searchParams: Promise<{ classroomId?: string }>;
}) {
  const { classroomId } = await searchParams;
  return <NewExerciseClient classroomId={classroomId} />;
}
