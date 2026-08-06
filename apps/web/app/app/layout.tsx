import { AppNav } from "@/components/app-shell/AppNav";
import { MaintenanceBanner } from "@/components/app-shell/MaintenanceBanner";
import { MobileRouteGuard } from "@/components/app-shell/MobileRouteGuard";
import { RouteTitleSync } from "@/components/app-shell/RouteTitleSync";
import { UserPreferencesProvider } from "@/components/app-shell/UserPreferencesProvider";

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
      <MaintenanceBanner />
      <div className="app-frame">
        <UserPreferencesProvider>
          <AppNav />
          <main className="app-main" id="main-content">
            <MobileRouteGuard>{children}</MobileRouteGuard>
          </main>
        </UserPreferencesProvider>
      </div>
    </>
  );
}
