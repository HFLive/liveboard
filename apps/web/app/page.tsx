import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  Presentation,
  ShieldCheck,
} from "lucide-react";
import "./home.css";

export default function HomePage() {
  return (
    <main className="marketing-page">
      <section className="marketing-hero">
        <nav className="marketing-nav" aria-label="首页导航">
          <Link className="marketing-brand" href="/">
            <span>LB</span>
            <strong>LiveBoard</strong>
          </Link>
          <div className="marketing-nav-actions">
            <a className="marketing-nav-link" href="#workflow">
              功能
            </a>
            <Link className="marketing-login-link" href="/login">
              登录
            </Link>
          </div>
        </nav>

        <div className="marketing-hero-inner">
          <div className="marketing-copy">
            <h1>LiveBoard</h1>
            <p>
              团队共用的教学工作台。整理资料、准备课程、发布练习、管理成员。
            </p>
            <div className="marketing-actions">
              <Link className="home-primary-button" href="/login">
                登录
                <ArrowRight aria-hidden="true" className="button-icon right" />
              </Link>
              <a className="home-secondary-button" href="#workflow">
                查看功能
              </a>
            </div>
          </div>

          <div className="marketing-scene" aria-hidden="true">
            <div className="scene-window scene-window-main">
              <div className="scene-window-bar">
                <span />
                <span />
                <span />
              </div>
              <div className="scene-app">
                <aside>
                  <b>LiveBoard</b>
                  <span className="active">公共资料</span>
                  <span>课程文件</span>
                  <span>练习反馈</span>
                  <span>成员权限</span>
                </aside>
                <div className="scene-content">
                  <div className="scene-path">文档 / 第一讲教案</div>
                  <div className="scene-document-head">
                    <h2>第一讲：直播基础</h2>
                    <span>已发布</span>
                  </div>
                  <p className="scene-document-meta">
                    教案 · 3 个内容块 · 更新于 7 月 10 日
                  </p>
                  <div className="scene-note">
                    <strong>课程目标</strong>
                    <p>理解一场直播从准备、开播到复盘的基本流程。</p>
                  </div>
                  <div className="scene-outline">
                    <span>01　设备与环境检查</span>
                    <span>02　直播流程</span>
                    <span>03　课后练习</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="marketing-section" id="workflow">
        <div className="marketing-section-head">
          <h2>主要功能</h2>
        </div>
        <div className="marketing-feature-grid">
          <article>
            <BookOpen aria-hidden="true" />
            <h3>整理资料</h3>
            <p>用文件夹和块编辑器编写、查找和引用教学文档。</p>
          </article>
          <article>
            <Presentation aria-hidden="true" />
            <h3>课件展示</h3>
            <p>把已有文档组合成课件，并直接用于课堂展示。</p>
          </article>
          <article>
            <ClipboardCheck aria-hidden="true" />
            <h3>练习与批阅</h3>
            <p>发布练习，自动批改客观题，集中处理人工批阅。</p>
          </article>
          <article>
            <ShieldCheck aria-hidden="true" />
            <h3>成员与权限</h3>
            <p>按成员和权限组控制资料的查看、编辑与管理范围。</p>
          </article>
        </div>
      </section>

      <section className="marketing-cta">
        <div>
          <h2>登录 LiveBoard</h2>
        </div>
        <Link className="home-primary-button" href="/login">
          登录
          <ArrowRight aria-hidden="true" className="button-icon right" />
        </Link>
      </section>
    </main>
  );
}
