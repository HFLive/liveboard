import type { Metadata } from "next";
import {
  ClassroomDetailClient,
  type ClassroomTab,
} from "./ClassroomDetailClient";
import "../classrooms.css";

export const metadata: Metadata = { title: "课堂" };

const CLASSROOM_TABS: readonly ClassroomTab[] = [
  "announcements",
  "teaching",
  "exercises",
  "files",
  "members",
];

export default async function ClassroomDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const initialTab = CLASSROOM_TABS.includes(tab as ClassroomTab)
    ? (tab as ClassroomTab)
    : undefined;
  return <ClassroomDetailClient classroomId={id} initialTab={initialTab} />;
}
