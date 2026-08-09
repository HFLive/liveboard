"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageSquare, Settings } from "lucide-react";
import type { UserProfile, UserPublicActivity } from "@liveboard/shared";
import {
  apiResourceUrl,
  getMe,
  getUserProfile,
  getUserPublicActivity,
} from "@/lib/api";
import { APP_ROUTES, forumThread } from "@/lib/routes";
import { formatRelativeTime } from "@/lib/labels";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { UserBadges } from "@/components/UserBadges";
import { UserContributionHeatmap } from "./UserContributionHeatmap";

export function UserProfileClient({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  useDocumentTitle(profile?.displayName ?? null);
  const [isOwnProfile, setIsOwnProfile] = useState(false);
  const [activity, setActivity] = useState<UserPublicActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getUserProfile(userId), getMe()])
      .then(([profileResult, meResult]) => {
        setProfile(profileResult.user);
        setIsOwnProfile(profileResult.user.id === meResult.user.id);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "加载个人主页失败"),
      );
    setActivityLoading(true);
    getUserPublicActivity(userId)
      .then(setActivity)
      .catch(() => setActivity(null))
      .finally(() => setActivityLoading(false));
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
                <div className="user-profile-name">
                  <h1>{profile.displayName}</h1>
                  <UserBadges badges={profile.badges} />
                </div>
                <p>@{profile.username}</p>
              </div>
              {isOwnProfile ? (
                <Link className="button secondary" href={APP_ROUTES.profile}>
                  <Settings aria-hidden="true" className="button-icon" />
                  资料设置
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
          <div className="user-profile-contributions">
            <UserContributionHeatmap userId={userId} />
          </div>
          <div className="user-profile-activity">
            <section aria-labelledby="profile-forum-title">
              <div className="user-profile-section-head">
                <h2 id="profile-forum-title">论坛帖子</h2>
              </div>
              {activityLoading ? (
                <div className="skeleton user-profile-activity-skeleton" />
              ) : activity?.forumThreads.length ? (
                <div className="user-profile-activity-list">
                  {activity.forumThreads.map((thread) => (
                    <Link href={forumThread(thread.id)} key={thread.id}>
                      <MessageSquare aria-hidden="true" />
                      <strong>{thread.title}</strong>
                      <span>
                        {thread.categoryName} · {thread.postCount} 条内容 ·{" "}
                        {formatRelativeTime(thread.lastActivityAt)}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="muted user-profile-empty">暂无公开帖子</p>
              )}
            </section>
          </div>
        </article>
      ) : null}
    </div>
  );
}
