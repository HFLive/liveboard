import { AiSettingsClient } from "./AiSettingsClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "AI 服务" };

export default function AdminAiPage() {
  return <AiSettingsClient />;
}
