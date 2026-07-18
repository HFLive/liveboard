import { ContentClient } from "./ContentClient";
import "./content.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "文档" };

export default function ContentPage() {
  return <ContentClient />;
}
