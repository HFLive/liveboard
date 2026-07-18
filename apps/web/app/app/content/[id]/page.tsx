import "./content-viewer.css";
import { FileViewer } from "./FileViewer";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "文档" };

export default async function FileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <FileViewer fileId={id} />;
}
