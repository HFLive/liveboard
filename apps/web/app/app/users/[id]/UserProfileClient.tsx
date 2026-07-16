"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Settings } from "lucide-react";
import type { UserProfile } from "@liveboard/shared";
import { apiResourceUrl, getMe, getUserProfile } from "@/lib/api";
import { APP_ROUTES } from "@/lib/routes";

export function UserProfileClient({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isOwnProfile, setIsOwnProfile] = useState(false);
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
        </article>
      ) : null}
    </div>
  );
}
