/**
 * embedbase types.
 *
 * The core talks to a Chroma-compatible HTTP service only through an
 * injectable fetch function, so every request shape and response path
 * can be tested with a fake fetch and no live service.
 */

/** Minimal HTTP response surface so tests can inject fixtures. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: string;
  },
) => Promise<HttpResponse>;

export interface CollectionInfo {
  id?: string;
  name?: string;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface ListCollectionsOptions {
  limit?: number;
  offset?: number;
}

export interface CreateCollectionOptions {
  collection_name: string;
  metadata?: Record<string, unknown>;
  embedding_function_name?: string;
}

export interface PeekOptions {
  collection_name: string;
  limit?: number;
}

export interface ModifyOptions {
  collection_name: string;
  new_name?: string;
  new_metadata?: Record<string, unknown>;
}

export interface AddDocumentsOptions {
  collection_name: string;
  documents: string[];
  metadatas?: Array<Record<string, unknown>>;
  ids?: string[];
}

export interface QueryDocumentsOptions {
  collection_name: string;
  query_texts: string[];
  n_results?: number;
  where?: Record<string, unknown>;
  where_document?: Record<string, unknown>;
  include?: string[];
}

export interface GetDocumentsOptions {
  collection_name: string;
  ids?: string[];
  where?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  include?: string[];
}

export interface UpdateDocumentsOptions {
  collection_name: string;
  ids: string[];
  documents?: string[];
  metadatas?: Array<Record<string, unknown>>;
  embeddings?: number[][];
}

export interface DeleteDocumentsOptions {
  collection_name: string;
  ids?: string[];
  where?: Record<string, unknown>;
}
