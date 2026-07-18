import { NewExerciseClient } from "./NewExerciseClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "新建练习" };

export default function NewExercisePage() {
  return <NewExerciseClient />;
}
