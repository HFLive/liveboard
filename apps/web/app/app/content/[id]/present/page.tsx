import { FilePresenter } from "./FilePresenter";

export default async function FilePresentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <FilePresenter fileId={id} />;
}
