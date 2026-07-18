import { ProfileClient } from "./ProfileClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "个人设置" };

export default function ProfilePage() {
  return <ProfileClient />;
}
