import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import "./home.css";

const FEATURES = [
  {
    index: "01",
    title: "资料",
    description: "课程文档与附件资料。",
  },
  {
    index: "02",
    title: "课件",
    description: "跟随课堂进度翻页展示。",
  },
  {
    index: "03",
    title: "练习",
    description: "在线作答，客观题自动评分。",
  },
  {
    index: "04",
    title: "论坛",
    description: "课程相关的提问与讨论。",
  },
] as const;

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
        <h1>
          这里是 HFLive 的
          <span className="marketing-keep">
            教学平台<span className="marketing-period">。</span>
          </span>
        </h1>
        <p className="marketing-lede">
          课程资料、课堂课件与在线练习，使用课程团队提供的账号登录。
        </p>
        <div className="marketing-actions">
          <Link className="home-primary-button" href="/login">
            登录
            <ArrowRight aria-hidden="true" className="button-icon right" />
          </Link>
        </div>

        <div className="marketing-index">
          {FEATURES.map((feature) => (
            <article key={feature.index}>
              <span aria-hidden="true">{feature.index}</span>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="marketing-footer">
        <span>HFLive</span>
        <a
          href="https://github.com/HFLive/liveboard"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
          <ArrowUpRight aria-hidden="true" />
        </a>
      </footer>
    </main>
  );
}
