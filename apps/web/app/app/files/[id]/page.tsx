import { redirect } from "next/navigation";
import { contentDetail } from "@/lib/routes";

export default async function LegacyFilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(contentDetail(id));
}
