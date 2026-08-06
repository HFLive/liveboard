"use client";

import { Check, Copy, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  createApiToken,
  getMe,
  listApiTokens,
  listUsers,
  revokeApiToken,
  type ApiTokenSummary,
  type CreateApiTokenResult,
} from "@/lib/api";
import { formatDateTimeWithYear, formatRelativeTime } from "@/lib/labels";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

interface CreatedToken extends CreateApiTokenResult {
  name: string;
  userId: string;
}

export function ApiTokensClient() {
  useDocumentTitle("访问令牌");
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [users, setUsers] = useState<
    Array<{ id: string; username: string; displayName: string }>
  >([]);
  // 普通管理员只能管理自己的令牌；最高管理员可管理全部成员令牌
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [actor, setActor] = useState<{
    id: string;
    displayName: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [copied, setCopied] = useState(false);

  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [filterUserId, setFilterUserId] = useState("all");

  const visibleTokens = useMemo(
    () =>
      filterUserId === "all"
        ? tokens
        : tokens.filter((token) => token.userId === filterUserId),
    [filterUserId, tokens],
  );

  useEffect(() => {
    Promise.all([getMe(), listApiTokens(), listUsers()])
      .then(([meResult, tokenResult, userResult]) => {
        const me = meResult.user;
        setIsSuperAdmin(me.systemRole === "super_admin");
        setActor({ id: me.id, displayName: me.displayName });
        setTokens(tokenResult.tokens);
        const activeUsers = userResult.users
          .filter((user) => user.status === "active")
          .map((user) => ({
            id: user.id,
            username: user.username,
            displayName: user.displayName,
          }));
        setUsers(activeUsers);
        if (me.systemRole === "super_admin") {
          const firstUser = activeUsers[0];
          if (firstUser) setUserId(firstUser.id);
        } else {
          setUserId(me.id);
        }
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "加载访问令牌失败");
      });
  }, []);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!userId) return;
    setCreating(true);
    setError(null);
    setMessage(null);
    setCreated(null);
    try {
      const result = await createApiToken({
        userId,
        name: name.trim(),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      setCreated({ ...result, name: name.trim(), userId });
      setName("");
      setExpiresAt("");
      const tokenResult = await listApiTokens();
      setTokens(tokenResult.tokens);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建令牌失败");
    } finally {
      setCreating(false);
    }
  }

  async function onRevoke(token: ApiTokenSummary) {
    if (
      !window.confirm(
        `确定撤销令牌「${token.name}」吗？撤销后立即失效，且不可恢复。`,
      )
    ) {
      return;
    }
    setRevokingId(token.id);
    setError(null);
    setMessage(null);
    try {
      await revokeApiToken(token.id);
      const tokenResult = await listApiTokens();
      setTokens(tokenResult.tokens);
      setMessage(`已撤销令牌「${token.name}」`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "撤销令牌失败");
    } finally {
      setRevokingId(null);
    }
  }

  async function onCopy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败，请手动选中复制");
    }
  }

  const selectedUserName = useMemo(() => {
    if (!created) return "";
    const user = users.find((item) => item.id === created.userId);
    return user ? user.displayName : "";
  }, [created, users]);

  return (
    <div className="workspace admin-workspace admin-page admin-page--wide api-tokens-page">
      <AdminPageHeader
        category="系统与服务"
        description="供 MCP 等外部客户端以用户身份调用 API 的个人访问令牌。"
        title="访问令牌"
      />

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      {created ? (
        <section className="token-created" aria-live="polite">
          <div className="token-created-head">
            <strong>令牌已创建</strong>
            <span>
              明文只在这一次显示，请立即保存到客户端配置；数据库只存哈希。
            </span>
            <button
              aria-label="关闭"
              className="token-created-close"
              onClick={() => setCreated(null)}
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <code className="token-plaintext">{created.token}</code>
          <div className="token-created-meta">
            <span>
              <strong>名称</strong>
              {created.name}
            </span>
            <span>
              <strong>用户</strong>
              {selectedUserName}
            </span>
          </div>
          <div className="button-row">
            <button className="button secondary" onClick={onCopy} type="button">
              {copied ? (
                <Check aria-hidden="true" />
              ) : (
                <Copy aria-hidden="true" />
              )}
              {copied ? "已复制" : "复制令牌"}
            </button>
          </div>
        </section>
      ) : null}

      <section className="token-create">
        <form className="token-create-form" onSubmit={onCreate}>
          <div className="token-create-field">
            <label htmlFor="token-user">归属用户</label>
            {isSuperAdmin ? (
              <select
                className="select"
                id="token-user"
                onChange={(event) => setUserId(event.target.value)}
                value={userId}
              >
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName}（{user.username}）
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                id="token-user"
                readOnly
                value={actor?.displayName ?? ""}
              />
            )}
            <span className="token-create-hint">
              {isSuperAdmin
                ? "令牌将以此用户的身份操作文档"
                : "管理员只能创建自己的令牌，令牌将以此用户身份操作文档"}
            </span>
          </div>
          <div className="token-create-field">
            <label htmlFor="token-name">名称</label>
            <input
              className="input"
              id="token-name"
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="如 claude-code"
              required
              value={name}
            />
          </div>
          <div className="token-create-field">
            <label htmlFor="token-expires">过期时间（可选）</label>
            <input
              className="input"
              id="token-expires"
              onChange={(event) => setExpiresAt(event.target.value)}
              type="datetime-local"
              value={expiresAt}
            />
          </div>
          <button
            className="button"
            disabled={creating || !userId}
            type="submit"
          >
            {creating ? "创建中…" : "创建令牌"}
          </button>
        </form>
      </section>

      <section className="token-list">
        <div className="token-list-head">
          <h2>已创建的令牌</h2>
          {isSuperAdmin ? (
            <label className="token-list-filter">
              <span>按用户筛选</span>
              <select
                className="select compact-select"
                onChange={(event) => setFilterUserId(event.target.value)}
                value={filterUserId}
              >
                <option value="all">全部用户</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {visibleTokens.length === 0 ? (
          <p className="token-list-empty">
            还没有令牌。创建后即可在客户端配置中使用。
          </p>
        ) : (
          <ul className="token-rows">
            {visibleTokens.map((token) => {
              const revoked = token.revokedAt !== null;
              const expired =
                !revoked &&
                token.expiresAt !== null &&
                new Date(token.expiresAt).getTime() <= Date.now();
              return (
                <li className="token-row" key={token.id}>
                  <div className="token-row-main">
                    <strong>{token.name}</strong>
                    <span className="token-row-user">{token.username}</span>
                  </div>
                  <div className="token-row-meta">
                    <code className="token-prefix">{token.tokenPrefix}…</code>
                    <span>创建于 {formatRelativeTime(token.createdAt)}</span>
                    {token.lastUsedAt ? (
                      <span>
                        最近使用 {formatRelativeTime(token.lastUsedAt)}
                      </span>
                    ) : (
                      <span>从未使用</span>
                    )}
                    {token.expiresAt ? (
                      <span>
                        过期于 {formatDateTimeWithYear(token.expiresAt)}
                      </span>
                    ) : null}
                  </div>
                  <div className="token-row-actions">
                    {revoked ? (
                      <span className="token-status">已撤销</span>
                    ) : expired ? (
                      <span className="token-status">已过期</span>
                    ) : null}
                    <button
                      className="button secondary"
                      disabled={revoked || revokingId === token.id}
                      onClick={() => onRevoke(token)}
                      type="button"
                    >
                      {revokingId === token.id ? "撤销中…" : "撤销"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
