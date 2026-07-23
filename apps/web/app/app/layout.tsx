import { AppNav } from "@/components/app-shell/AppNav";
import { MobileRouteGuard } from "@/components/app-shell/MobileRouteGuard";
import { RouteTitleSync } from "@/components/app-shell/RouteTitleSync";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <RouteTitleSync />
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <div className="app-frame">
        <AppNav />
        <main className="app-main" id="main-content">
          <MobileRouteGuard>{children}</MobileRouteGuard>
        </main>
      </div>
    </>
  );
}
