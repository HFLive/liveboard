import Link from "next/link";
import { LoginForm } from "./LoginForm";
import "./login.css";

export default function LoginPage() {
  return (
    <main className="login-wrap">
      <div className="login-card">
        <Link className="login-brand-link" href="/">
          <span>LB</span>
          <strong>LiveBoard</strong>
        </Link>
        <div className="login-card-head">
          <h1>登录</h1>
          <p>使用管理员为你分配的账号。</p>
        </div>
        <LoginForm />
        <p className="login-support">账号问题请联系管理员。</p>
      </div>
    </main>
  );
}
