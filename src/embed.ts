/**
 * embedbase core: a client for a Chroma-compatible HTTP API (v2).
 *
 * Collections live under
 *   /api/v2/tenants/default_tenant/databases/default_database/collections
 * Collection-scoped document operations need the collection id, which
 * the client resolves from the name with a GET on the collection
 * resource before calling the id-scoped endpoints:
 *   POST .../collections/{id}/add | /query | /get | /update | /delete
 *   GET  .../collections/{id}/count
 * Peek is a bounded `get` with a limit.
 *
 * All HTTP goes through an injected FetchFn. The base URL comes from
 * CHROMA_URL or EMBEDBASE_URL, defaulting to http://localhost:8000.
 * No behaviour against a live service is assumed here: request
 * shaping, error surfacing, and response parsing are what the unit
 * tests pin down with fakes.
 */
import type {
  AddDocumentsOptions,
  CollectionInfo,
  CreateCollectionOptions,
  DeleteDocumentsOptions,
  FetchFn,
  GetDocumentsOptions,
  ListCollectionsOptions,
  ModifyOptions,
  PeekOptions,
  QueryDocumentsOptions,
  UpdateDocumentsOptions,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_BASE_URL = "http://localhost:8000";

export const TENANT_PATH =
  "/api/v2/tenants/default_tenant/databases/default_database";

export function resolveBaseUrl(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw =
    explicit?.trim() ||
    env.EMBEDBASE_URL?.trim() ||
    env.CHROMA_URL?.trim() ||
    DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, "");
}

function collectionsPath(baseUrl: string): string {
  return `${baseUrl}${TENANT_PATH}/collections`;
}

async function parseBody(text: string): Promise<unknown> {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class EmbedbaseClient {
  readonly baseUrl: string;

  constructor(
    private readonly fetchFn: FetchFn,
    baseUrl?: string,
  ) {
    this.baseUrl = resolveBaseUrl(baseUrl);
  }

  private async request(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<unknown> {
    let response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw new Error(
        `Request to ${url} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Chroma request failed: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${text ? `: ${text.slice(0, 500)}` : ""}`,
      );
    }
    return parseBody(text);
  }

  /** Resolve a collection name to its server-side info (incl. id). */
  async getCollection(collectionName: string): Promise<CollectionInfo> {
    const url = `${collectionsPath(this.baseUrl)}/${encodeURIComponent(collectionName)}`;
    const data = await this.request("GET", url);
    return (data ?? {}) as CollectionInfo;
  }

  private async resolveId(collectionName: string): Promise<string> {
    const info = await this.getCollection(collectionName);
    const id = info.id;
    if (typeof id !== "string" || !id) {
      throw new Error(`Collection '${collectionName}' did not return an id`);
    }
    return id;
  }

  async listCollections(
    options: ListCollectionsOptions = {},
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.offset !== undefined) params.set("offset", String(options.offset));
    const qs = params.toString();
    const url = `${collectionsPath(this.baseUrl)}${qs ? `?${qs}` : ""}`;
    return this.request("GET", url);
  }

  async createCollection(options: CreateCollectionOptions): Promise<unknown> {
    const name = options.collection_name?.trim();
    if (!name) throw new Error("collection_name must be a non-empty string");
    const body: Record<string, unknown> = { name };
    if (options.metadata !== undefined) body.metadata = options.metadata;
    if (options.embedding_function_name !== undefined) {
      body.embedding_function_name = options.embedding_function_name;
    }
    return this.request("POST", collectionsPath(this.baseUrl), body);
  }

  async peekCollection(options: PeekOptions): Promise<unknown> {
    const id = await this.resolveId(options.collection_name);
    const limit = options.limit ?? 10;
    return this.request(
      "POST",
      `${collectionsPath(this.baseUrl)}/${encodeURIComponent(id)}/get`,
      { limit, include: ["documents", "metadatas"] },
    );
  }

  async getCollectionInfo(collectionName: string): Promise<unknown> {
    return this.getCollection(collectionName);
  }

  async getCollectionCount(collectionName: string): Promise<unknown> {
    const id = await this.resolveId(collectionName);
    const data = await this.request(
      "GET",
      `${collectionsPath(this.baseUrl)}/${encodeURIComponent(id)}/count`,
    );
    if (typeof data === "number") return data;
    if (data && typeof data === "object" && "count" in data) {
      return (data as { count: unknown }).count;
    }
    return data;
  }

  async modifyCollection(options: ModifyOptions): Promise<unknown> {
    const id = await this.resolveId(options.collection_name);
    const body: Record<string, unknown> = {};
    if (options.new_name !== undefined) body.name = options.new_name;
    if (options.new_metadata !== undefined) body.metadata = options.new_metadata;
    return this.request(
      "PUT",
      `${collectionsPath(this.baseUrl)}/${encodeURIComponent(id)}`,
      body,
    );
  }

  async deleteCollection(collectionName: string): Promise<unknown> {
    const url = `${collectionsPath(this.baseUrl)}/${encodeURIComponent(collectionName)}`;
    return this.request("DELETE", url);
  }

  async addDocuments(options: AddDocumentsOptions): Promise<unknown> {
    if (!Array.isArray(options.documents) || options.documents.length === 0) {
      throw new Error("documents must be a non-empty array of strings");
    }
    const id = await this.resolveId(options.collection_name);
    const ids =
      options.ids && options.ids.length > 0
        ? options.ids
        : options.documents.map((_, i) => `doc-${i}`);
    const body: Record<string, unknown> = {
      ids,
      documents: options.documents,
    };
    if (options.metadatas !== undefined) body.metadatas = options.metadatas;
    return this.request(
      "POST",
      `${collectionsPath(this.baseUrl)}/${encodeURIComponent(id)}/add`,
      body,
    );
  }

  async queryDocuments(options: QueryDocumentsOptions): Promise<unknown> {
    if (!Array.isArray(options.query_texts) || options.query_texts.length === 0) {
      throw new Error("query_texts must be a non-empty array of strings");
    }
    const id = await this.resolveId(options.collection_name);
    const body: Record<string, unknown> = {
      query_texts: options.query_texts,
      n_results: options.n_results ?? 10,
    };
    if (options.where !== undefined) body.where = options.where;
    if (options.where_document !== undefined) {
      body.where_document = options.where_document;
    }
    if (options.include !== undefined) body.include = options.include;
    return this.request(
      "POST",
      `${collectionsPath(this.baseUrl)}/${encodeURIComponent(id)}/query`,
      body,
    );
  }

  async getDocuments(options: GetDocumentsOptions): Promise<unknown> {
    const id = await this.resolveId(options.collection_name);
    const body: Record<string, unknown> = {};
    if (options.ids !== undefined) body.ids = options.ids;
    if (options.where !== undefined) body.where = options.where;
    if (options.limit !== undefined) body.limit = options.limit;
    if (options.offset !== undefined) body.offset = options.offset;
    if (options.include !== undefined) body.include = options.include;
    return this.request(
      "POST",
      `${collectionsPath(this.baseUrl)}/${encodeURIComponent(id)}/get`,
      body,
    );
  }

  async updateDocuments(options: UpdateDocumentsOptions): Promise<unknown> {
    if (!Array.isArray(options.ids) || options.ids.length === 0) {
      throw new Error("ids must be a non-empty array of strings");
    }
    const id = await this.resolveId(options.collection_name);
    const body: Record<string, unknown> = { ids: options.ids };
    if (options.documents !== undefined) body.documents = options.documents;
    if (options.metadatas !== undefined) body.metadatas = options.metadatas;
    if (options.embeddings !== undefined) body.embeddings = options.embeddings;
    return this.request(
      "POST",
      `${collectionsPath(this.baseUrl)}/${encodeURIComponent(id)}/update`,
      body,
    );
  }

  async deleteDocuments(options: DeleteDocumentsOptions): Promise<unknown> {
    const id = await this.resolveId(options.collection_name);
    const body: Record<string, unknown> = {};
    if (options.ids !== undefined) body.ids = options.ids;
    if (options.where !== undefined) body.where = options.where;
    return this.request(
      "POST",
      `${collectionsPath(this.baseUrl)}/${encodeURIComponent(id)}/delete`,
      body,
    );
  }
}

export function createClient(fetchFn: FetchFn, baseUrl?: string): EmbedbaseClient {
  return new EmbedbaseClient(fetchFn, baseUrl);
}
