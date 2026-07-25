import type { Metadata } from "next";
import { ClassroomsClient } from "./ClassroomsClient";
import "./classrooms.css";

export const metadata: Metadata = { title: "课堂" };

export default function ClassroomsPage() {
  return <ClassroomsClient />;
}
