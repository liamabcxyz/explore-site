import { traceFetch, getFetchTrace, clearFetchTrace } from "@/lib/debug/trace";

function fakeResponse({ status = 200, ok = true, contentLength = 1024 } = {}) {
  return {
    status,
    ok,
    headers: { get: (name) => (name.toLowerCase() === "content-length" ? String(contentLength) : null) },
  };
}

describe("debug fetch trace", () => {
  beforeEach(() => clearFetchTrace());

  it("records a successful fetch's source, url, status, ok, and bytes", async () => {
    await traceFetch("stac", "https://example/catalog.json", async () =>
      fakeResponse({ status: 200, contentLength: 4200 })
    );
    const trace = getFetchTrace();
    expect(trace).toHaveLength(1);
    expect(trace[0]).toMatchObject({
      source: "stac",
      url: "https://example/catalog.json",
      status: 200,
      ok: true,
      bytes: 4200,
    });
    expect(typeof trace[0].ms).toBe("number");
    expect(typeof trace[0].at).toBe("string");
  });

  it("records a failed HTTP response without throwing", async () => {
    await traceFetch("terrarium", "https://example/t.png", async () =>
      fakeResponse({ status: 404, ok: false, contentLength: 0 })
    );
    const [entry] = getFetchTrace();
    expect(entry).toMatchObject({ status: 404, ok: false });
  });

  it("records a thrown error and re-throws so callers keep their error handling", async () => {
    await expect(
      traceFetch("corridor-buildings", "pmtiles://x#14/1/2", async () => {
        throw new Error("network down");
      })
    ).rejects.toThrow("network down");
    const [entry] = getFetchTrace();
    expect(entry).toMatchObject({
      source: "corridor-buildings",
      status: 0,
      ok: false,
      error: "network down",
    });
  });

  it("returns a defensive copy from getFetchTrace so callers can't mutate the buffer", async () => {
    await traceFetch("stac", "https://a", async () => fakeResponse());
    const snapshot = getFetchTrace();
    snapshot.push({ hijacked: true });
    expect(getFetchTrace()).toHaveLength(1);
  });

  it("caps the ring buffer so long sessions don't leak memory", async () => {
    for (let i = 0; i < 250; i++) {
      await traceFetch("terrarium", `https://t/${i}`, async () => fakeResponse());
    }
    const trace = getFetchTrace();
    expect(trace.length).toBeLessThanOrEqual(200);
    // Oldest entries drop first (FIFO): last entry is #249.
    expect(trace[trace.length - 1].url).toBe("https://t/249");
  });
});
