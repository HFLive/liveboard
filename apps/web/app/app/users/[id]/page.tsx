import { UserProfileClient } from "./UserProfileClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "个人主页" };

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <UserProfileClient userId={id} />;
}
