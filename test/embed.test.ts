import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EmbedbaseClient, resolveBaseUrl, TENANT_PATH } from "../src/embed.js";
import type { FetchFn, HttpResponse } from "../src/types.js";

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

function jsonResponse(status: number, body: unknown): HttpResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { get: () => null },
    text: async () => text,
  };
}

/** Fake fetch that routes by method+url suffix and records calls. */
function makeFake(
  handler: (call: RecordedCall) => HttpResponse,
): { fetchFn: FetchFn; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const call: RecordedCall = {
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return handler(call);
  };
  return { fetchFn, calls };
}

const COLLECTION = { id: "col-123", name: "notes", metadata: { topic: "test" } };

function collectionAware(call: RecordedCall): HttpResponse {
  // GET collection by name returns the collection record with its id.
  if (call.method === "GET" && call.url.endsWith("/collections/notes")) {
    return jsonResponse(200, COLLECTION);
  }
  return jsonResponse(200, { ok: true });
}

describe("resolveBaseUrl", () => {
  it("defaults to http://localhost:8000", () => {
    assert.equal(resolveBaseUrl(undefined, {}), "http://localhost:8000");
  });
  it("prefers EMBEDBASE_URL, then CHROMA_URL, and trims trailing slashes", () => {
    assert.equal(
      resolveBaseUrl(undefined, { EMBEDBASE_URL: "http://a:1/", CHROMA_URL: "http://b:2" }),
      "http://a:1",
    );
    assert.equal(resolveBaseUrl(undefined, { CHROMA_URL: "http://b:2/" }), "http://b:2");
    assert.equal(resolveBaseUrl("http://x:9/", {}), "http://x:9");
  });
});

describe("listCollections", () => {
  it("GETs the v2 collections path with pagination params", async () => {
    const { fetchFn, calls } = makeFake(() => jsonResponse(200, [COLLECTION]));
    const client = new EmbedbaseClient(fetchFn, "http://localhost:8000");
    const out = await client.listCollections({ limit: 5, offset: 10 });
    assert.deepEqual(out, [COLLECTION]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "GET");
    assert.ok(calls[0].url.includes(`${TENANT_PATH}/collections`));
    assert.ok(calls[0].url.includes("limit=5"));
    assert.ok(calls[0].url.includes("offset=10"));
  });
  it("omits query string when no pagination is given", async () => {
    const { fetchFn, calls } = makeFake(() => jsonResponse(200, []));
    const client = new EmbedbaseClient(fetchFn);
    await client.listCollections();
    assert.ok(!calls[0].url.includes("?"));
  });
});

describe("createCollection", () => {
  it("POSTs name, metadata, and embedding function to the collections path", async () => {
    const { fetchFn, calls } = makeFake(() => jsonResponse(200, COLLECTION));
    const client = new EmbedbaseClient(fetchFn);
    await client.createCollection({
      collection_name: "notes",
      metadata: { topic: "test" },
      embedding_function_name: "default",
    });
    assert.equal(calls[0].method, "POST");
    assert.deepEqual(calls[0].body, {
      name: "notes",
      metadata: { topic: "test" },
      embedding_function_name: "default",
    });
  });
  it("rejects an empty collection name before any request", async () => {
    const { fetchFn, calls } = makeFake(() => jsonResponse(200, {}));
    const client = new EmbedbaseClient(fetchFn);
    await assert.rejects(() => client.createCollection({ collection_name: " " }), /non-empty/);
    assert.equal(calls.length, 0);
  });
});

describe("info / count / delete collection", () => {
  it("getCollectionInfo GETs the named collection", async () => {
    const { fetchFn, calls } = makeFake(collectionAware);
    const client = new EmbedbaseClient(fetchFn);
    const out = await client.getCollectionInfo("notes");
    assert.deepEqual(out, COLLECTION);
    assert.equal(calls[0].method, "GET");
    assert.ok(calls[0].url.endsWith("/collections/notes"));
  });
  it("getCollectionCount resolves the id then GETs the count endpoint", async () => {
    const { fetchFn, calls } = makeFake((call) => {
      if (call.url.endsWith("/count")) return jsonResponse(200, "42");
      return collectionAware(call);
    });
    const client = new EmbedbaseClient(fetchFn);
    const out = await client.getCollectionCount("notes");
    assert.equal(out, 42);
    assert.equal(calls.length, 2);
    assert.ok(calls[1].url.endsWith("/collections/col-123/count"));
    assert.equal(calls[1].method, "GET");
  });
  it("deleteCollection DELETEs the named collection", async () => {
    const { fetchFn, calls } = makeFake(() => jsonResponse(200, { ok: true }));
    const client = new EmbedbaseClient(fetchFn);
    await client.deleteCollection("notes");
    assert.equal(calls[0].method, "DELETE");
    assert.ok(calls[0].url.endsWith("/collections/notes"));
  });
  it("modifyCollection resolves the id then PUTs the new name/metadata", async () => {
    const { fetchFn, calls } = makeFake(collectionAware);
    const client = new EmbedbaseClient(fetchFn);
    await client.modifyCollection({
      collection_name: "notes",
      new_name: "notes-v2",
      new_metadata: { topic: "v2" },
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].method, "PUT");
    assert.ok(calls[1].url.endsWith("/collections/col-123"));
    assert.deepEqual(calls[1].body, { name: "notes-v2", metadata: { topic: "v2" } });
  });
  it("peekCollection POSTs a bounded get against the resolved id", async () => {
    const { fetchFn, calls } = makeFake(collectionAware);
    const client = new EmbedbaseClient(fetchFn);
    await client.peekCollection({ collection_name: "notes", limit: 3 });
    assert.equal(calls[1].method, "POST");
    assert.ok(calls[1].url.endsWith("/collections/col-123/get"));
    assert.deepEqual(calls[1].body, { limit: 3, include: ["documents", "metadatas"] });
  });
});

describe("document operations", () => {
  it("addDocuments POSTs ids/documents/metadatas to /add", async () => {
    const { fetchFn, calls } = makeFake(collectionAware);
    const client = new EmbedbaseClient(fetchFn);
    await client.addDocuments({
      collection_name: "notes",
      documents: ["alpha", "beta"],
      metadatas: [{ n: 1 }, { n: 2 }],
      ids: ["a1", "b2"],
    });
    assert.ok(calls[1].url.endsWith("/collections/col-123/add"));
    assert.deepEqual(calls[1].body, {
      ids: ["a1", "b2"],
      documents: ["alpha", "beta"],
      metadatas: [{ n: 1 }, { n: 2 }],
    });
  });
  it("addDocuments generates deterministic ids when none are given", async () => {
    const { fetchFn, calls } = makeFake(collectionAware);
    const client = new EmbedbaseClient(fetchFn);
    await client.addDocuments({ collection_name: "notes", documents: ["x", "y"] });
    assert.deepEqual((calls[1].body as { ids: string[] }).ids, ["doc-0", "doc-1"]);
  });
  it("queryDocuments POSTs query_texts and filters to /query with n_results default 10", async () => {
    const { fetchFn, calls } = makeFake(collectionAware);
    const client = new EmbedbaseClient(fetchFn);
    await client.queryDocuments({
      collection_name: "notes",
      query_texts: ["hello"],
      where: { topic: "test" },
      include: ["documents"],
    });
    assert.ok(calls[1].url.endsWith("/collections/col-123/query"));
    assert.deepEqual(calls[1].body, {
      query_texts: ["hello"],
      n_results: 10,
      where: { topic: "test" },
      include: ["documents"],
    });
  });
  it("getDocuments POSTs ids/limit to /get", async () => {
    const { fetchFn, calls } = makeFake(collectionAware);
    const client = new EmbedbaseClient(fetchFn);
    await client.getDocuments({ collection_name: "notes", ids: ["a1"], limit: 5 });
    assert.ok(calls[1].url.endsWith("/collections/col-123/get"));
    assert.deepEqual(calls[1].body, { ids: ["a1"], limit: 5 });
  });
  it("updateDocuments POSTs ids and new values to /update", async () => {
    const { fetchFn, calls } = makeFake(collectionAware);
    const client = new EmbedbaseClient(fetchFn);
    await client.updateDocuments({
      collection_name: "notes",
      ids: ["a1"],
      documents: ["revised"],
      embeddings: [[0.1, 0.2]],
    });
    assert.ok(calls[1].url.endsWith("/collections/col-123/update"));
    assert.deepEqual(calls[1].body, {
      ids: ["a1"],
      documents: ["revised"],
      embeddings: [[0.1, 0.2]],
    });
  });
  it("deleteDocuments POSTs ids/where to /delete", async () => {
    const { fetchFn, calls } = makeFake(collectionAware);
    const client = new EmbedbaseClient(fetchFn);
    await client.deleteDocuments({ collection_name: "notes", ids: ["a1"] });
    assert.ok(calls[1].url.endsWith("/collections/col-123/delete"));
    assert.deepEqual(calls[1].body, { ids: ["a1"] });
  });
});

describe("error handling", () => {
  it("surfaces HTTP errors with status and body excerpt", async () => {
    const { fetchFn } = makeFake(() => jsonResponse(500, "boom"));
    const client = new EmbedbaseClient(fetchFn);
    await assert.rejects(() => client.listCollections(), /HTTP 500/);
  });
  it("surfaces transport failures", async () => {
    const failing: FetchFn = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const client = new EmbedbaseClient(failing);
    await assert.rejects(() => client.listCollections(), /ECONNREFUSED/);
  });
  it("errors when the collection lookup returns no id", async () => {
    const { fetchFn } = makeFake(() => jsonResponse(200, { name: "notes" }));
    const client = new EmbedbaseClient(fetchFn);
    await assert.rejects(
      () => client.getDocuments({ collection_name: "notes" }),
      /did not return an id/,
    );
  });
});
