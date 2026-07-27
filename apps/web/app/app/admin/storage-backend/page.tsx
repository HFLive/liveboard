import { StorageBackendClient } from "./StorageBackendClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "存储后端" };

export default function AdminStorageBackendPage() {
  return <StorageBackendClient />;
}
