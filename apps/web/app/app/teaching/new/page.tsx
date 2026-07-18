import { TeachingEditor } from "../TeachingEditor";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "新建课件" };

export default function NewTeachingDeckPage() {
  return <TeachingEditor />;
}
