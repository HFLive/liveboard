const BILIBILI_PLAYER_HOST = "player.bilibili.com";
const BILIBILI_VIDEO_HOSTS = new Set(["www.bilibili.com", "bilibili.com"]);

export function normalizeBilibiliEmbedUrl(value: string) {
  const candidate = extractEmbedSource(value.trim());
  if (!candidate) return null;

  const withProtocol = candidate.startsWith("//")
    ? `https:${candidate}`
    : candidate;

  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    if (url.hostname === BILIBILI_PLAYER_HOST) {
      if (url.pathname !== "/player.html") return null;
      return buildPlayerUrl({
        bvid: normalizeBvid(url.searchParams.get("bvid")),
        aid: normalizeNumericId(url.searchParams.get("aid")),
        cid: normalizeNumericId(url.searchParams.get("cid")),
        page: normalizePage(url.searchParams.get("p")),
      });
    }

    if (BILIBILI_VIDEO_HOSTS.has(url.hostname)) {
      const match = url.pathname.match(/^\/video\/(BV[a-zA-Z0-9]+|av\d+)/i);
      if (!match) return null;
      const id = match[1];
      if (!id) return null;
      return buildPlayerUrl({
        bvid: id.toLowerCase().startsWith("bv") ? normalizeBvid(id) : null,
        aid: id.toLowerCase().startsWith("av")
          ? normalizeNumericId(id.slice(2))
          : null,
        cid: null,
        page: normalizePage(url.searchParams.get("p")),
      });
    }
  } catch {
    return null;
  }

  return null;
}

function extractEmbedSource(value: string) {
  if (!value) return null;
  const iframeSource = value.match(
    /<iframe\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/i,
  );
  if (iframeSource) return iframeSource[1] ?? iframeSource[2] ?? null;
  return value.includes("<") || value.includes(">") ? null : value;
}

function buildPlayerUrl(input: {
  bvid: string | null;
  aid: string | null;
  cid: string | null;
  page: string | null;
}) {
  if (!input.bvid && !input.aid) return null;
  const url = new URL("https://player.bilibili.com/player.html");
  if (input.bvid) url.searchParams.set("bvid", input.bvid);
  if (input.aid) url.searchParams.set("aid", input.aid);
  if (input.cid) url.searchParams.set("cid", input.cid);
  if (input.page) url.searchParams.set("p", input.page);
  url.searchParams.set("autoplay", "0");
  return url.toString();
}

function normalizeBvid(value: string | null) {
  return value && /^BV[a-zA-Z0-9]+$/.test(value) ? value : null;
}

function normalizeNumericId(value: string | null) {
  return value && /^\d+$/.test(value) ? value : null;
}

function normalizePage(value: string | null) {
  return value && /^\d{1,4}$/.test(value) && Number(value) > 0 ? value : null;
}
