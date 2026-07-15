import "./content-viewer.css";
import { FileViewer } from "./FileViewer";

export default async function FileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <FileViewer fileId={id} />;
}
