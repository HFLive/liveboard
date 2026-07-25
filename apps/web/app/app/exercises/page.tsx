import "./exercises.css";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { APP_ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "练习" };

export default function ExercisesPage() {
  redirect(APP_ROUTES.classrooms);
}
