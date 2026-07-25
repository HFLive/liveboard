import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { APP_ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "课件" };

export default function TeachingPage() {
  redirect(APP_ROUTES.classrooms);
}
