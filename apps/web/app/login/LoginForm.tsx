"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { login } from "@/lib/api";
import { APP_ROUTES } from "@/lib/routes";

const showDemoDefaults =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS === "true";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState(showDemoDefaults ? "admin" : "");
  const [password, setPassword] = useState(
    showDemoDefaults ? "liveboard-admin" : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const demoAccounts = [
    { label: "最高管理员", username: "admin", password: "liveboard-admin" },
    { label: "内容维护", username: "author", password: "liveboard-author" },
    { label: "授课者", username: "lecturer", password: "liveboard-lecturer" },
    { label: "学习者", username: "learner", password: "liveboard-learner" },
  ];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await login(username, password);
      router.replace(APP_ROUTES.ai);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="form login-form" onSubmit={onSubmit}>
      <label className="label">
        登录账号
        <input
          aria-describedby={error ? "login-error" : undefined}
          aria-invalid={Boolean(error)}
          className="input"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="输入登录账号"
          required
        />
      </label>
      <label className="label">
        密码
        <span className="password-field">
          <input
            aria-describedby={error ? "login-error" : undefined}
            aria-invalid={Boolean(error)}
            className="input"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="输入密码"
            required
          />
          <button
            aria-label={showPassword ? "隐藏密码" : "显示密码"}
            className="password-toggle"
            onClick={() => setShowPassword((current) => !current)}
            type="button"
          >
            {showPassword ? (
              <EyeOff aria-hidden="true" />
            ) : (
              <Eye aria-hidden="true" />
            )}
          </button>
        </span>
      </label>
      {error ? (
        <p
          aria-live="polite"
          className="error-text login-error"
          id="login-error"
        >
          {error}
        </p>
      ) : null}
      <button className="button login-submit" disabled={loading} type="submit">
        <LogIn aria-hidden="true" className="button-icon" />
        {loading ? "正在登录…" : "登录"}
      </button>

      {showDemoDefaults ? (
        <div className="demo-accounts">
          <div className="demo-accounts-head">
            <span>开发环境快捷登录</span>
            <small>点击自动填入</small>
          </div>
          <div className="demo-account-list" aria-label="测试账号">
            {demoAccounts.map((account) => (
              <button
                className={
                  username === account.username
                    ? "demo-account active"
                    : "demo-account"
                }
                key={account.username}
                onClick={() => {
                  setUsername(account.username);
                  setPassword(account.password);
                  setError(null);
                }}
                type="button"
              >
                <span>{account.label}</span>
                <span className="demo-account-credentials">
                  <strong>{account.username}</strong>
                  <code>{account.password}</code>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </form>
  );
}
