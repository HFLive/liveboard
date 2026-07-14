import type { Metadata } from "next";
import { ChunkLoadRecovery } from "@/components/system/ChunkLoadRecovery";
import "./globals.css";
import "./redesign.css";
import "katex/dist/katex.min.css";

export const metadata: Metadata = {
  title: {
    default: "LiveBoard",
    template: "%s · LiveBoard",
  },
  description: "教学资料、课程、练习与成员管理平台。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <ChunkLoadRecovery />
        {children}
      </body>
    </html>
  );
}
