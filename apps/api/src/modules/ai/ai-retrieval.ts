export interface RetrievalBlock {
  id: string;
  type: string;
  text: string;
  sortOrder: number;
}

export interface RetrievalFile {
  id: string;
  title: string;
  blocks: RetrievalBlock[];
}

export interface RankedRetrievalFile<T extends RetrievalFile> {
  file: T;
  score: number;
  blocks: RetrievalBlock[];
}

const QUERY_STOP_WORDS = new Set([
  "一个",
  "一下",
  "以及",
  "什么",
  "关于",
  "可以",
  "如何",
  "是否",
  "哪些",
  "怎么",
  "怎样",
  "我们",
  "我的",
  "请问",
  "这个",
  "那个",
]);

export function tokenizeRetrievalQuery(value: string) {
  const normalized = normalizeSearchText(value);
  const segments = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const tokens: string[] = [];

  for (const segment of segments) {
    if (segment.length < 2 || QUERY_STOP_WORDS.has(segment)) {
      continue;
    }

    tokens.push(segment);
    if (/[\u3400-\u9fff]/u.test(segment) && segment.length > 2) {
      for (let index = 0; index < segment.length - 1; index += 1) {
        const bigram = segment.slice(index, index + 2);
        if (!QUERY_STOP_WORDS.has(bigram)) {
          tokens.push(bigram);
        }
      }
    }
  }

  return [...new Set(tokens)].slice(0, 48);
}

export function rankRetrievalFiles<T extends RetrievalFile>(
  files: T[],
  query: string,
): Array<RankedRetrievalFile<T>> {
  const tokens = tokenizeRetrievalQuery(query);
  if (tokens.length === 0) {
    return [];
  }

  const queryPhrase = compactSearchText(query);
  const documentFrequency = new Map<string, number>();
  const searchableFiles = files.map((file) =>
    normalizeSearchText(
      `${file.title}\n${file.blocks.map((block) => block.text).join("\n")}`,
    ),
  );

  for (const token of tokens) {
    let matches = 0;
    for (const searchable of searchableFiles) {
      if (searchable.includes(token)) {
        matches += 1;
      }
    }
    documentFrequency.set(token, matches);
  }

  return files
    .map((file) => {
      const title = normalizeSearchText(file.title);
      const titleScore =
        scoreText(title, tokens, documentFrequency, files.length) * 3.2 +
        (queryPhrase.length >= 2 &&
        compactSearchText(title).includes(queryPhrase)
          ? 18
          : 0);
      const scoredBlocks = file.blocks
        .map((block) => ({
          block,
          score:
            scoreText(
              normalizeSearchText(block.text),
              tokens,
              documentFrequency,
              files.length,
            ) *
              blockTypeBoost(block.type) +
            (queryPhrase.length >= 3 &&
            compactSearchText(block.text).includes(queryPhrase)
              ? 14
              : 0),
        }))
        .filter((item) => item.score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.block.sortOrder - right.block.sortOrder,
        );
      const bestBlockScore = scoredBlocks[0]?.score ?? 0;
      const supportingBlockScore = scoredBlocks[1]?.score ?? 0;
      const score = titleScore + bestBlockScore + supportingBlockScore * 0.35;
      const selectedBlocks =
        scoredBlocks.length > 0
          ? scoredBlocks.slice(0, 6).map((item) => item.block)
          : titleScore > 0
            ? file.blocks.slice(0, 2)
            : [];

      return {
        file,
        score,
        blocks: selectedBlocks,
      };
    })
    .filter((item) => item.score > 0 && item.blocks.length > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.file.title.localeCompare(right.file.title, "zh-CN"),
    );
}

function scoreText(
  text: string,
  tokens: string[],
  documentFrequency: Map<string, number>,
  documentCount: number,
) {
  if (!text) {
    return 0;
  }

  let score = 0;
  let matchedTokens = 0;

  for (const token of tokens) {
    const occurrences = countOccurrences(text, token);
    if (occurrences === 0) {
      continue;
    }

    matchedTokens += 1;
    const frequency = documentFrequency.get(token) ?? 0;
    const inverseDocumentFrequency =
      Math.log(1 + (documentCount + 1) / (frequency + 1)) + 0.5;
    score +=
      inverseDocumentFrequency *
      Math.max(1, Math.min(token.length, 8) / 2) *
      (1 + Math.log(occurrences));
  }

  if (matchedTokens > 0) {
    score += (matchedTokens / tokens.length) * 8;
    score /= 1 + Math.log10(Math.max(1, text.length) / 160 + 1) * 0.22;
  }

  return score;
}

function blockTypeBoost(type: string) {
  if (/^heading_[1-6]$/u.test(type)) {
    return 1.35;
  }
  if (type === "question") {
    return 1.15;
  }
  return 1;
}

function normalizeSearchText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN");
}

function compactSearchText(value: string) {
  return normalizeSearchText(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function countOccurrences(value: string, keyword: string) {
  let count = 0;
  let index = value.indexOf(keyword);

  while (index !== -1) {
    count += 1;
    index = value.indexOf(keyword, index + keyword.length);
  }

  return count;
}
