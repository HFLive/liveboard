import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { LoginForm } from "./LoginForm";
import "./login.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "登录" };

export default function LoginPage() {
  return (
    <main className="login-wrap">
      <aside className="login-aside">
        <Link className="login-brand-link" href="/">
          <span>LB</span>
          <strong>LiveBoard</strong>
        </Link>
        <div className="login-aside-copy">
          <p className="login-aside-statement">
            这里是 HFLive 的教学平台<span>。</span>
          </p>
          <p className="login-aside-sub">课程资料、课堂课件与在线练习。</p>
        </div>
        <div className="login-aside-foot">
          <span>HFLive</span>
          <a
            href="https://github.com/HFLive/liveboard"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
            <ArrowUpRight aria-hidden="true" />
          </a>
        </div>
      </aside>

      <section className="login-main">
        <div className="login-column">
          <div className="login-card-head">
            <h1>登录</h1>
            <p>使用课程团队分配的账号。</p>
          </div>
          <LoginForm />
          <p className="login-support">账号问题请联系管理员。</p>
        </div>
      </section>
    </main>
  );
}
