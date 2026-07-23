import { ForumSettingsClient } from "./ForumSettingsClient";
import "./forum-admin.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "论坛版块" };

export default function AdminForumPage() {
  return <ForumSettingsClient />;
}
