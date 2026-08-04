import { MigrationClient } from "./MigrationClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "数据迁移" };

export default function AdminMigrationPage() {
  return <MigrationClient />;
}
