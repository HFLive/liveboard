import { FileEditor } from "../FileEditor";
import "./content-editor.css";
// 渲染态排版与查看页共用宋体，保证「所见即所得」的字体一致。
import "@fontsource/noto-serif-sc/400.css";
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
