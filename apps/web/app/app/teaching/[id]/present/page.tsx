import { TeachingPresenter } from "../../TeachingPresenter";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "课件展示" };

export default async function TeachingPresentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TeachingPresenter deckId={id} />;
}
