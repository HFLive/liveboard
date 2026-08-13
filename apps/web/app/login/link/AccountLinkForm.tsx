"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { linkHfliveWithPassword } from "@/lib/api";
import { APP_ROUTES } from "@/lib/routes";
import { InlineLoading, Spinner } from "@/components/system/Loading";

export function AccountLinkForm() {
  const router = useRouter();
  const [ticket, setTicket] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get(
      "ticket",
    );
    setTicket(value);
    setReady(true);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ticket) return;
    setLoading(true);
    setError(null);
    try {
      await linkHfliveWithPassword({ ticket, username, password });
      router.replace(APP_ROUTES.classrooms);
      router.refresh();
    } catch {
      setTicket(null);
      setError("无法关联账号。凭据不正确或本次关联已过期，请重新登录。 ");
    } finally {
      setLoading(false);
    }
  }

  if (!ready) return <InlineLoading label="正在读取关联请求…" />;
  if (!ticket) {
    return (
      <div className="login-link-expired" role="alert">
        <p>{error ?? "关联请求无效或已过期，请重新发起统一身份登录。"}</p>
        <Link className="button" href="/login">
          返回登录
        </Link>
      </div>
    );
  }

  return (
    <form className="form login-form" onSubmit={submit}>
      <div className="login-link-notice">
        <strong>需要旧 LiveBoard 账号密码</strong>
        <p>
          只有普通成员可以自助关联，且旧 LiveBoard 用户名必须与 HFLive Auth
          用户名一致。管理员账号请联系最高管理员处理，系统权限不会由统一身份自动授予。
        </p>
      </div>
      <label className="label">
        旧 LiveBoard 登录账号
        <input
          autoComplete="username"
          autoFocus
          className="input"
          onChange={(event) => setUsername(event.target.value)}
          required
          value={username}
        />
      </label>
      <label className="label">
        旧账号密码
        <input
          autoComplete="current-password"
          className="input"
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      <button className="button login-submit" disabled={loading} type="submit">
        {loading ? <Spinner size={16} className="button-icon" /> : null}
        {loading ? "正在关联…" : "确认关联并登录"}
      </button>
      <Link className="login-cancel-link" href="/login">
        取消并返回登录
      </Link>
    </form>
  );
}
