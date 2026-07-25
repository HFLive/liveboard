import { TeachingEditor } from "../TeachingEditor";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "新建课件" };

export default async function NewTeachingDeckPage({
  searchParams,
}: {
  searchParams: Promise<{ classroomId?: string }>;
}) {
  const { classroomId } = await searchParams;
  return <TeachingEditor classroomId={classroomId} />;
}
