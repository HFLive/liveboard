import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="login-wrap">
      <section className="login-shell">
        <div className="login-card">
          <Link className="login-back-link" href="/">
            <ArrowLeft aria-hidden="true" />
            返回首页
          </Link>
          <Link className="login-brand-link" href="/">
            <span>LB</span>
            <strong>LiveBoard</strong>
          </Link>
          <div className="login-card-head">
            <h1>登录 LiveBoard</h1>
            <p>使用管理员为你分配的账号。</p>
          </div>
          <LoginForm />
          <p className="login-support">账号问题请联系管理员。</p>
        </div>
      </section>
    </main>
  );
}
