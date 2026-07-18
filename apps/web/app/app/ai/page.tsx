import { AiAssistantClient } from "./AiAssistantClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "AI" };

export default function AiAssistantPage() {
  return <AiAssistantClient />;
}
