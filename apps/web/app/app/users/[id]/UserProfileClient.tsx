"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Settings } from "lucide-react";
import type { UserProfile, UserPublicActivity } from "@liveboard/shared";
import {
  apiResourceUrl,
  getMe,
  getUserProfile,
  getUserPublicActivity,
} from "@/lib/api";
import { APP_ROUTES, forumThread, teachingPresent } from "@/lib/routes";
import { formatRelativeTime } from "@/lib/labels";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export function UserProfileClient({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  useDocumentTitle(profile?.displayName ?? null);
  const [isOwnProfile, setIsOwnProfile] = useState(false);
  const [activity, setActivity] = useState<UserPublicActivity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getUserProfile(userId),
      getMe(),
      getUserPublicActivity(userId),
    ])
      .then(([profileResult, meResult, activityResult]) => {
        setProfile(profileResult.user);
        setIsOwnProfile(profileResult.user.id === meResult.user.id);
        setActivity(activityResult);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "加载个人主页失败"),
      );
  }, [userId]);

  return (
    <div className="workspace user-profile-page">
      {error ? <p className="error-text">{error}</p> : null}
      {!profile && !error ? (
        <div className="skeleton user-profile-skeleton" />
      ) : null}
      {profile ? (
        <article className="user-profile-card">
          <div className="user-profile-banner">
            {profile.bannerUrl ? (
              <img alt="" src={apiResourceUrl(profile.bannerUrl)} />
            ) : null}
          </div>
          <div className="user-profile-content">
            <div className="user-profile-avatar" aria-hidden="true">
              {profile.avatarUrl ? (
                <img alt="" src={apiResourceUrl(profile.avatarUrl)} />
              ) : (
                profile.displayName.trim().slice(0, 1).toUpperCase() || "L"
              )}
            </div>
            <div className="user-profile-heading">
              <div>
                <h1>{profile.displayName}</h1>
                <p>@{profile.username}</p>
              </div>
              {isOwnProfile ? (
                <Link className="button secondary" href={APP_ROUTES.profile}>
                  <Settings aria-hidden="true" className="button-icon" />
                  编辑个人主页
                </Link>
              ) : null}
            </div>
            <p
              className={
                profile.bio ? "user-profile-bio" : "user-profile-bio muted"
              }
            >
              {profile.bio ?? "这个用户还没有填写个人简介。"}
            </p>
          </div>
          <div className="user-profile-activity">
            <section>
              <div className="panel-head">
                <h2>公开课件</h2>
              </div>
              {activity?.teachingDecks.length ? (
                <div className="user-profile-activity-list">
                  {activity.teachingDecks.map((deck) => (
                    <Link href={teachingPresent(deck.id)} key={deck.id}>
                      <strong>{deck.title}</strong>
                      <span>{formatRelativeTime(deck.updatedAt)}</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="muted user-profile-empty">暂无可查看的课件</p>
              )}
            </section>
            <section>
              <div className="panel-head">
                <h2>论坛主题</h2>
              </div>
              {activity?.forumThreads.length ? (
                <div className="user-profile-activity-list">
                  {activity.forumThreads.map((thread) => (
                    <Link href={forumThread(thread.id)} key={thread.id}>
                      <strong>{thread.title}</strong>
                      <span>
                        {thread.categoryName} · {thread.postCount} 条内容 ·{" "}
                        {formatRelativeTime(thread.lastActivityAt)}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="muted user-profile-empty">暂无公开主题</p>
              )}
            </section>
          </div>
        </article>
      ) : null}
    </div>
  );
}
