import { SystemSettingsClient } from "./SystemSettingsClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "系统设置" };

export default function AdminSettingsPage() {
  return <SystemSettingsClient />;
}
