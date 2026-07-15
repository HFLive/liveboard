import { FileEditor } from "../FileEditor";

export default async function FileEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <FileEditor fileId={id} />;
}
