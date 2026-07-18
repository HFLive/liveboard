import { ForumThreadClient } from "./ForumThreadClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "帖子" };

export default async function ForumThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ForumThreadClient threadId={id} />;
}
