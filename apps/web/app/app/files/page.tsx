import { redirect } from "next/navigation";
import { APP_ROUTES } from "@/lib/routes";

export default function LegacyFilesPage() {
  redirect(APP_ROUTES.content);
}
