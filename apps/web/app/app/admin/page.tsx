import { redirect } from "next/navigation";
import { APP_ROUTES } from "@/lib/routes";

export default function AdminPage() {
  redirect(APP_ROUTES.adminUsers);
}
