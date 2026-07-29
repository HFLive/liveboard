import type { Metadata } from "next";
import { BadgeManagementClient } from "./BadgeManagementClient";
import "./badges.css";

export const metadata: Metadata = { title: "徽章管理" };

export default function AdminBadgesPage() {
  return <BadgeManagementClient />;
}
