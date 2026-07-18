import { UserManagementClient } from "./UserManagementClient";
import "./users.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "成员管理" };

export default function AdminUsersPage() {
  return <UserManagementClient />;
}
