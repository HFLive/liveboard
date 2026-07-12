import { FileEditor } from "./FileEditor";

export default async function FileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <FileEditor fileId={id} />;
}
