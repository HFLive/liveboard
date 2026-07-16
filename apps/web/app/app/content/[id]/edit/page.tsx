import { FileEditor } from "../FileEditor";
import "./content-editor.css";

export default async function FileEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <FileEditor fileId={id} />;
}
