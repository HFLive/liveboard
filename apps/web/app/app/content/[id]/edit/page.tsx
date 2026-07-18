import { FileEditor } from "../FileEditor";
import "./content-editor.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "编辑文档" };

export default async function FileEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <FileEditor fileId={id} />;
}
