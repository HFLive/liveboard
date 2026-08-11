import Link from "next/link";
import type { Metadata } from "next";
import { SiteBrandMark } from "@/components/app-shell/SiteBrandMark";
import { AccountLinkForm } from "./AccountLinkForm";
import "../login.css";

export const metadata: Metadata = { title: "关联 LiveBoard 账号" };

export default function AccountLinkPage() {
  return (
    <main className="login-wrap login-link-wrap">
      <aside className="login-aside">
        <Link className="login-brand-link" href="/">
          <SiteBrandMark tone="dark" />
          <strong>LiveBoard</strong>
        </Link>
        <div className="login-aside-copy">
          <p className="login-aside-statement">
            保留已有内容与权限<span>。</span>
          </p>
          <p className="login-aside-sub">
            证明旧账号归属后，统一身份只会绑定到这一个 LiveBoard 账号。
          </p>
        </div>
        <div className="login-aside-foot">
          <span>HFLive</span>
        </div>
      </aside>
      <section className="login-main">
        <div className="login-column login-link-column">
          <div className="login-card-head">
            <h1>关联已有账号</h1>
            <p>检测到相同的账号资料。LiveBoard 不会自动合并账号。</p>
          </div>
          <AccountLinkForm />
        </div>
      </section>
    </main>
  );
}
