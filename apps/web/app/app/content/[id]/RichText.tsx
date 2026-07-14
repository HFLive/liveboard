import { Fragment, type ReactNode } from "react";
import katex from "katex";

const INLINE_PATTERN_SOURCE =
  "(`+)([^\\n]*?)\\1|\\[([^\\]]+)\\]\\(([^\\s)]+)\\)|\\*\\*([^\\n*]+)\\*\\*|__([^\\n_]+)__|~~([^\\n~]+)~~|\\*([^\\n*]+)\\*|_([^\\n_]+)_|\\$([^$\\n]+)\\$";

export function isSafeRichTextHref(value: string) {
  if (value.startsWith("/") && !value.startsWith("//")) return true;

  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export function MathFormula({
  expression,
  display = false,
}: {
  expression: string;
  display?: boolean;
}) {
  const html = katex.renderToString(expression, {
    displayMode: display,
    throwOnError: false,
    trust: false,
    strict: "warn",
    maxExpand: 1000,
    maxSize: 10,
  });

  return (
    <span
      aria-label={expression}
      className={display ? "render-math display" : "render-math inline"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function RichText({
  text,
  enabled,
}: {
  text: string;
  enabled: boolean;
}) {
  if (!enabled) return <>{text}</>;

  return <>{renderInline(text)}</>;
}

function renderInline(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(INLINE_PATTERN_SOURCE, "g");
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    if (match.index > cursor) {
      nodes.push(value.slice(cursor, match.index));
    }

    const key = `${match.index}-${match[0]}`;
    if (match[2] !== undefined) {
      nodes.push(<code key={key}>{match[2]}</code>);
    } else if (match[3] !== undefined && match[4] !== undefined) {
      const label = renderInline(match[3]);
      nodes.push(
        isSafeRichTextHref(match[4]) ? (
          <a href={match[4]} key={key} rel="noreferrer" target="_blank">
            {label}
          </a>
        ) : (
          <Fragment key={key}>
            {label}（不安全链接：{match[4]}）
          </Fragment>
        ),
      );
    } else if (match[5] !== undefined || match[6] !== undefined) {
      nodes.push(
        <strong key={key}>{renderInline(match[5] ?? match[6] ?? "")}</strong>,
      );
    } else if (match[7] !== undefined) {
      nodes.push(<del key={key}>{renderInline(match[7])}</del>);
    } else if (match[8] !== undefined || match[9] !== undefined) {
      nodes.push(<em key={key}>{renderInline(match[8] ?? match[9] ?? "")}</em>);
    } else if (match[10] !== undefined) {
      nodes.push(<MathFormula expression={match[10]} key={key} />);
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}
