import { embedTexts, embeddingEndpoint } from "./ai-embeddings";

describe("Embedding provider contract", () => {
  const config = {
    baseUrl: "https://example.test/v1",
    model: "embedding-test",
    apiKey: "secret",
    dimensions: 2,
  };
  afterEach(() => jest.restoreAllMocks());

  it("orders outputs by input index and requests float vectors without forcing unsupported dimensions", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        }),
      ),
    );
    await expect(embedTexts(config, ["one", "two"])).resolves.toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/v1/embeddings",
      expect.objectContaining({
        redirect: "error",
        body: JSON.stringify({
          model: config.model,
          input: ["one", "two"],
          encoding_format: "float",
        }),
      }),
    );
  });

  it.each([
    { data: [{ index: 0, embedding: [1, 0, 0] }] },
    { data: [{ index: 0, embedding: [0, 0] }] },
    { data: [{ index: 1, embedding: [1, 0] }] },
    { data: [] },
  ])("rejects malformed, zero, or mismatched vectors", async (body) => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(embedTexts(config, ["one"])).rejects.toThrow();
  });

  it("does not expose provider response bodies in errors", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("secret document contents", { status: 401 }),
      );
    await expect(embedTexts(config, ["one"])).rejects.toThrow(
      "向量服务请求失败（HTTP 401）",
    );
  });

  it("preserves caller cancellation instead of retrying or hiding it", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    await expect(
      embedTexts(config, ["one"], { signal: controller.signal }),
    ).rejects.toThrow("cancelled");
  });

  it("rejects credentials and query strings in endpoints", () => {
    expect(() =>
      embeddingEndpoint("https://user:secret@example.test/v1"),
    ).toThrow();
    expect(() =>
      embeddingEndpoint("https://example.test?key=secret"),
    ).toThrow();
    expect(embeddingEndpoint("http://localhost:8080/v1/embeddings/")).toBe(
      "http://localhost:8080/v1/embeddings",
    );
  });
});
