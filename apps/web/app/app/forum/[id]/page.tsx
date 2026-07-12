import { ForumThreadClient } from "./ForumThreadClient";

export default async function ForumThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ForumThreadClient threadId={id} />;
}
