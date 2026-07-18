import { TeachingEditor } from "../../TeachingEditor";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "编辑课件" };

export default async function EditTeachingDeckPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TeachingEditor deckId={id} />;
}
