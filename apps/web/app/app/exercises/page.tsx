import { ExercisesClient } from "./ExercisesClient";
import "./exercises.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "练习" };

export default function ExercisesPage() {
  return <ExercisesClient />;
}
