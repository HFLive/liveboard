import type { Metadata } from "next";
import { ContentPermissionsClient } from "./ContentPermissionsClient";

export const metadata: Metadata = { title: "文档权限" };

export default function ContentPermissionsPage() {
  return <ContentPermissionsClient />;
}
