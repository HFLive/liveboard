import { ForumSettingsClient } from "./ForumSettingsClient";
import "./forum-admin.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "版块管理" };

export default function AdminForumPage() {
  return <ForumSettingsClient />;
}
