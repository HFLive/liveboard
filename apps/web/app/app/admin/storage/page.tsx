import { StorageManagementClient } from "./StorageManagementClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "存储容量" };

export default function AdminStoragePage() {
  return <StorageManagementClient />;
}
