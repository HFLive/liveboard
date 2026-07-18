import { ContentPermissionsClient } from "./ContentPermissionsClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "文档权限" };

export default function AdminContentPermissionsPage() {
  return <ContentPermissionsClient />;
}
