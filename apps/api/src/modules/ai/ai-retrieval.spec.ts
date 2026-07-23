import {
  rankRetrievalFiles,
  tokenizeRetrievalQuery,
  type RetrievalFile,
} from "./ai-retrieval";

const file = (
  id: string,
  title: string,
  blocks: Array<{ text: string; type?: string }>,
): RetrievalFile => ({
  id,
  title,
  blocks: blocks.map((block, index) => ({
    id: `${id}-block-${index}`,
    type: block.type ?? "paragraph",
    text: block.text,
    sortOrder: index * 10,
  })),
});

describe("AI retrieval ranking", () => {
  it("expands Chinese questions into useful bigrams", () => {
    expect(tokenizeRetrievalQuery("线路组需要负责什么？")).toEqual(
      expect.arrayContaining(["线路", "路组", "需要", "负责"]),
    );
  });

  it("prefers exact title and phrase matches", () => {
    const ranked = rankRetrievalFiles(
      [
        file("generic", "直播团队手册", [
          { text: "线路组负责设备搭建和走线。" },
        ]),
        file("exact", "线路组职责", [
          { text: "线路组职责包括设备搭建、走线和系统操作。" },
        ]),
      ],
      "线路组职责",
    );

    expect(ranked.map((item) => item.file.id)).toEqual(["exact", "generic"]);
  });

  it("returns the matching block instead of the start of a document", () => {
    const ranked = rankRetrievalFiles(
      [
        file("manual", "直播团队手册", [
          { text: "前言和一般说明。" },
          { text: "线路组负责设备搭建、走线和系统操作。" },
          { text: "附录。" },
        ]),
      ],
      "线路组负责什么",
    );

    expect(ranked[0]?.blocks[0]?.text).toContain("设备搭建");
  });

  it("does not return unrelated documents", () => {
    expect(
      rankRetrievalFiles(
        [file("unrelated", "请假制度", [{ text: "年假审批流程。" }])],
        "线路组设备清单",
      ),
    ).toEqual([]);
  });
});
