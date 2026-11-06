import type {
  RetrievalFile,
  RetrievalBlock,
  RankedRetrievalFile,
} from "./ai-retrieval";

export interface DocumentChunk extends RetrievalBlock {
  ordinal: number;
  embeddingText: string;
}

/** Bound individual inputs and retain section context, including for long blocks. */
export function chunkDocument(file: RetrievalFile): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let heading = "";
  for (const block of file.blocks) {
    const text = block.text.trim();
    if (!text) continue;
    if (/^heading_[1-6]$/u.test(block.type)) heading = text.slice(0, 300);
    const chars = Array.from(text);
    for (let start = 0, part = 0; start < chars.length; part += 1) {
      let end = Math.min(start + 1200, chars.length);
      if (end < chars.length) {
        const tail = chars.slice(start + 700, end).join("");
        const boundaries = [...tail.matchAll(/[。！？.!?\n]/gu)];
        const last = boundaries.at(-1);
        if (last?.index !== undefined) {
          end = start + 700 + Array.from(tail.slice(0, last.index + 1)).length;
        }
      }
      const body = chars.slice(start, end).join("");
      const content =
        heading && heading !== text ? heading + "\n" + body : body;
      chunks.push({
        id: part === 0 ? block.id : block.id + ":chunk:" + part,
        type: block.type,
        text: content,
        sortOrder: chunks.length,
        ordinal: chunks.length,
        embeddingText: file.title + "\n" + content,
      });
      if (end === chars.length) break;
      start = end - 160;
    }
  }
  return chunks;
}

export interface SemanticHit extends RetrievalBlock {
  fileId: string;
  similarity: number;
}

/** Reciprocal rank fusion avoids comparing incompatible lexical/cosine scores. */
export function fuseRetrievalRanks<T extends RetrievalFile>(
  files: T[],
  lexical: Array<RankedRetrievalFile<T>>,
  semantic: SemanticHit[],
): Array<RankedRetrievalFile<T>> {
  if (!semantic.length) return lexical;
  const byId = new Map(files.map((file) => [file.id, file]));
  const ranks = new Map<
    string,
    {
      score: number;
      blocks: Map<string, { block: RetrievalBlock; score: number }>;
    }
  >();
  const add = (fileId: string, blocks: RetrievalBlock[], rank: number) => {
    if (!byId.has(fileId)) return;
    const item = ranks.get(fileId) ?? { score: 0, blocks: new Map() };
    item.score += 1 / (60 + rank);
    blocks.forEach((block, index) => {
      const previous = item.blocks.get(block.id);
      item.blocks.set(block.id, {
        block,
        score: (previous?.score ?? 0) + 1 / (60 + index + 1),
      });
    });
    ranks.set(fileId, item);
  };
  lexical.forEach((item, index) => add(item.file.id, item.blocks, index + 1));
  const semanticFiles = new Map<string, SemanticHit[]>();
  for (const hit of semantic) {
    const hits = semanticFiles.get(hit.fileId) ?? [];
    hits.push(hit);
    semanticFiles.set(hit.fileId, hits);
  }
  [...semanticFiles].forEach(([id, hits], index) => add(id, hits, index + 1));
  return [...ranks]
    .map(([id, item]) => ({
      file: byId.get(id)!,
      score: item.score,
      blocks: [...item.blocks.values()]
        .sort(
          (a, b) => b.score - a.score || a.block.sortOrder - b.block.sortOrder,
        )
        .slice(0, 6)
        .map((item) => item.block),
    }))
    .sort(
      (a, b) =>
        b.score - a.score || a.file.title.localeCompare(b.file.title, "zh-CN"),
    );
}
