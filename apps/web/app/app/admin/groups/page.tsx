import { PermissionGroupsClient } from "./PermissionGroupsClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "权限组" };

export default function AdminPermissionGroupsPage() {
  return <PermissionGroupsClient />;
}
