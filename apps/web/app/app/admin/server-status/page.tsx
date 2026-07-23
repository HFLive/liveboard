import type { Metadata } from "next";
import { ServerStatusClient } from "./ServerStatusClient";

export const metadata: Metadata = { title: "服务器状态" };

export default function AdminServerStatusPage() {
  return <ServerStatusClient />;
}
