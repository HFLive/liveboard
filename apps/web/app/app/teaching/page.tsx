import { TeachingClient } from "./TeachingClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "课件" };

export default function TeachingPage() {
  return <TeachingClient />;
}
