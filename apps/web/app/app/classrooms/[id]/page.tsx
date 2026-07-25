import type { Metadata } from "next";
import { ClassroomDetailClient } from "./ClassroomDetailClient";
import "../classrooms.css";

export const metadata: Metadata = { title: "课堂" };

export default async function ClassroomDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClassroomDetailClient classroomId={id} />;
}
