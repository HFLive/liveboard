import { LibraryClient } from "./LibraryClient";
import "./library.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "文件" };

export default function LibraryPage() {
  return <LibraryClient />;
}
