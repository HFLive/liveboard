import { chunkDocument, fuseRetrievalRanks } from "./ai-rag-retrieval";
import { rankRetrievalFiles } from "./ai-retrieval";

describe("RAG chunking and rank fusion", () => {
  it("retains the tail of long Chinese blocks, section context, and bounded inputs", () => {
    const chunks = chunkDocument({
      id: "doc",
      title: "手册",
      blocks: [
        {
          id: "heading",
          type: "heading_2",
          text: "设备故障处理",
          sortOrder: 0,
        },
        {
          id: "body",
          type: "paragraph",
          text: "😀检查设备。".repeat(600) + "末尾操作说明",
          sortOrder: 1,
        },
      ],
    });
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.at(-1)?.text).toContain("末尾操作说明");
    expect(
      chunks.slice(1).every((chunk) => chunk.text.startsWith("设备故障处理\n")),
    ).toBe(true);
    expect(
      chunks.every((chunk) => Array.from(chunk.embeddingText).length < 1600),
    ).toBe(true);
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(chunks.length);
    expect(chunks.every((chunk) => !chunk.text.includes("\ufffd"))).toBe(true);
  });

  it("retrieves a semantic match with no matching literal words", () => {
    const files = [
      {
        id: "doc",
        title: "检修手册",
        blocks: [
          {
            id: "block",
            type: "paragraph",
            text: "显示设备发生故障，请检查电源接线。",
            sortOrder: 0,
          },
        ],
      },
    ];
    const lexical = rankRetrievalFiles(files, "画面突然黑了");
    expect(lexical).toEqual([]);
    const ranked = fuseRetrievalRanks(files, lexical, [
      {
        fileId: "doc",
        ...files[0]!.blocks[0]!,
        similarity: 0.9,
      },
    ]);
    expect(ranked[0]?.file.id).toBe("doc");
    expect(ranked[0]?.blocks[0]?.text).toContain("电源");
  });

  it("retains lexical results and ignores semantic IDs outside the allowed files", () => {
    const files = [
      {
        id: "allowed",
        title: "设备手册",
        blocks: [
          { id: "block", type: "paragraph", text: "设备清单", sortOrder: 0 },
        ],
      },
    ];
    const lexical = rankRetrievalFiles(files, "设备");
    const ranked = fuseRetrievalRanks(files, lexical, [
      {
        fileId: "forbidden",
        id: "secret",
        type: "paragraph",
        text: "secret",
        sortOrder: 0,
        similarity: 1,
      },
    ]);
    expect(ranked.map((item) => item.file.id)).toEqual(["allowed"]);
    expect(fuseRetrievalRanks(files, lexical, [])).toBe(lexical);
  });
});
