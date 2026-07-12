import { redirect } from "next/navigation";
import { contentPresentation } from "@/lib/routes";

export default async function LegacyFilePresentationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(contentPresentation(id));
}
