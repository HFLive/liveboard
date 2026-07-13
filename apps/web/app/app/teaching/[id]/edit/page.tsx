import { TeachingEditor } from "../../TeachingEditor";

export default async function EditTeachingDeckPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TeachingEditor deckId={id} />;
}
