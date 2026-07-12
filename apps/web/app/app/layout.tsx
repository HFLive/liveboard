import { AppNav } from "@/components/app-shell/AppNav";
import { AppSettingsProvider } from "@/components/app-shell/AppSettingsProvider";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <div className="app-frame">
        <AppNav />
        <main className="app-main" id="main-content">
          <AppSettingsProvider>{children}</AppSettingsProvider>
        </main>
      </div>
    </>
  );
}
