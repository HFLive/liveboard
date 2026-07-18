import { StorageManagementClient } from "./StorageManagementClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "容量管理" };

export default function AdminStoragePage() {
  return <StorageManagementClient />;
}
