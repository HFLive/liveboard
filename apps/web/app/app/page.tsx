import { redirect } from "next/navigation";
import { APP_ROUTES } from "@/lib/routes";

export default function AppIndexPage() {
  redirect(APP_ROUTES.ai);
}
