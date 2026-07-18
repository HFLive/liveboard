import { ForumClient } from "./ForumClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "论坛" };

export default function ForumPage() {
  return <ForumClient />;
}
