import { NewForumThreadClient } from "./NewForumThreadClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "发布主题" };

export default function NewForumThreadPage() {
  return <NewForumThreadClient />;
}
