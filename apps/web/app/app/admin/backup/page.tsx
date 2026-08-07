import { BackupClient } from "./BackupClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "备份与回滚" };

export default function AdminBackupPage() {
  return <BackupClient />;
}
