import type { Metadata } from "next";
import { ApiTokensClient } from "./ApiTokensClient";
import "./api-tokens.css";

export const metadata: Metadata = { title: "访问令牌" };

export default function AdminApiTokensPage() {
  return <ApiTokensClient />;
}
