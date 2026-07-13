import { TeachingPresenter } from "../../TeachingPresenter";

export default async function TeachingPresentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TeachingPresenter deckId={id} />;
}
