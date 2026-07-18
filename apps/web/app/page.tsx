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
      <nav className="marketing-nav" aria-label="首页导航">
        <Link className="marketing-brand" href="/">
          <span>LB</span>
          <strong>LiveBoard</strong>
        </Link>
        <Link className="marketing-login-link" href="/login">
          登录
        </Link>
      </nav>

      <section className="marketing-hero">
        <div className="marketing-copy">
          <h1>团队共用的教学工作台</h1>
          <p>整理资料、准备课程、发布练习、管理成员，都在一个地方。</p>
          <div className="marketing-actions">
            <Link className="home-primary-button" href="/login">
              登录
              <ArrowRight aria-hidden="true" className="button-icon right" />
            </Link>
          </div>
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
            <h3>练习与批改</h3>
            <p>发布练习，自动批改客观题，集中处理人工批改。</p>
          </article>
          <article>
            <ShieldCheck aria-hidden="true" />
            <h3>成员与权限</h3>
            <p>按成员和权限组控制资料的查看、编辑与管理范围。</p>
          </article>
        </div>
      </section>
    </main>
  );
}
