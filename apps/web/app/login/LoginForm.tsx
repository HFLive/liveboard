"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LogIn, ShieldAlert } from "lucide-react";
import type { AuthCapabilities } from "@liveboard/shared";
import {
  ApiError,
  breakglassLogin,
  getAuthCapabilities,
  hfliveLoginUrl,
  login,
} from "@/lib/api";
import { APP_ROUTES } from "@/lib/routes";

const showDemoDefaults =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS === "true";

export function LoginForm({ reason }: { reason?: string }) {
  const router = useRouter();
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(
    null,
  );
  const [username, setUsername] = useState(showDemoDefaults ? "admin" : "");
  const [password, setPassword] = useState(
    showDemoDefaults ? "liveboard-admin" : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capabilityError, setCapabilityError] = useState(false);

  useEffect(() => {
    let active = true;
    getAuthCapabilities()
      .then((result) => {
        if (active) setCapabilities(result);
      })
      .catch(() => {
        if (active) setCapabilityError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const demoAccounts = [
    { label: "最高管理员", username: "admin", password: "liveboard-admin" },
    { label: "文档维护", username: "author", password: "liveboard-author" },
    { label: "课件制作", username: "lecturer", password: "liveboard-lecturer" },
    { label: "学习者", username: "learner", password: "liveboard-learner" },
  ];

  async function onSubmit(
    event: FormEvent<HTMLFormElement>,
    emergency = false,
  ) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await (emergency
        ? breakglassLogin(username, password)
        : login(username, password));
      router.replace(APP_ROUTES.classrooms);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 401
          ? emergency
            ? "紧急登录失败，请确认最高管理员凭据"
            : "账号或密码错误"
          : caught instanceof Error
            ? caught.message
            : "登录失败",
      );
    } finally {
      setLoading(false);
    }
  }

  if (capabilityError) {
    return (
      <div className="login-capability-error" role="alert">
        <p>暂时无法确认可用的登录方式。</p>
        <button className="button secondary" onClick={() => location.reload()}>
          重新加载
        </button>
      </div>
    );
  }

  if (!capabilities) {
    return <p className="muted login-loading">正在确认登录方式…</p>;
  }

  const localForm = (emergency = false) => (
    <form
      className="form login-form"
      onSubmit={(event) => void onSubmit(event, emergency)}
    >
      <label className="label">
        登录账号
        <input
          aria-describedby={error ? "login-error" : undefined}
          aria-invalid={Boolean(error)}
          autoFocus={!capabilities.hfliveOidc}
          className="input"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="输入登录账号"
          required
        />
      </label>
      <div className="label">
        <label htmlFor={emergency ? "breakglass-password" : "login-password"}>
          密码
        </label>
        <span className="password-field">
          <input
            aria-describedby={error ? "login-error" : undefined}
            aria-invalid={Boolean(error)}
            className="input"
            id={emergency ? "breakglass-password" : "login-password"}
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
      </div>
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
        {loading ? "正在登录…" : emergency ? "紧急登录" : "登录"}
      </button>

      {showDemoDefaults && !emergency ? (
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

  return (
    <div className="login-methods">
      {reason === "hflive-failed" ? (
        <p className="error-text login-error" role="alert">
          HFLive Auth 登录未完成，请重新尝试。
        </p>
      ) : null}
      {capabilities.hfliveOidc ? (
        <a className="button login-hflive" href={hfliveLoginUrl()}>
          <LogIn aria-hidden="true" />
          使用 HFLive Auth 登录
        </a>
      ) : null}
      {capabilities.hfliveOidc && capabilities.localLogin ? (
        <div className="login-method-divider">
          <span>或使用本地账号</span>
        </div>
      ) : null}
      {capabilities.localLogin ? localForm() : null}
      {capabilities.breakglass ? (
        <details className="login-breakglass">
          <summary>
            <ShieldAlert aria-hidden="true" />
            紧急管理员入口
          </summary>
          <p>仅供统一身份服务故障时由最高管理员使用，所有尝试均会记录审计。</p>
          {localForm(true)}
        </details>
      ) : null}
    </div>
  );
}
