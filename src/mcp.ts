/**
 * embedbase MCP server. 12 tools covering collections and documents.
 *
 * Why the low-level Server instead of McpServer: the high-level helper
 * converts zod schemas to JSON Schema and injects keys that are not in
 * this tool's public spec ("$schema" and "additionalProperties"),
 * which breaks exact tool-list/schema parity with the spec. This file
 * serves tools/list with the spec's exact input schemas as explicit
 * literals, while zod still validates every tools/call argument set.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { EmbedbaseClient, VERSION } from "./embed.js";
import type { FetchFn } from "./types.js";

const ListArgs = z.object({
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
});
const CreateArgs = z.object({
  collection_name: z.string(),
  metadata: z.record(z.unknown()).optional(),
  embedding_function_name: z.string().optional(),
});
const PeekArgs = z.object({
  collection_name: z.string(),
  limit: z.number().int().optional(),
});
const NameArgs = z.object({ collection_name: z.string() });
const ModifyArgs = z.object({
  collection_name: z.string(),
  new_name: z.string().optional(),
  new_metadata: z.record(z.unknown()).optional(),
});
const AddArgs = z.object({
  collection_name: z.string(),
  documents: z.array(z.string()),
  metadatas: z.array(z.record(z.unknown())).optional(),
  ids: z.array(z.string()).optional(),
});
const QueryArgs = z.object({
  collection_name: z.string(),
  query_texts: z.array(z.string()),
  n_results: z.number().int().optional(),
  where: z.record(z.unknown()).optional(),
  where_document: z.record(z.unknown()).optional(),
  include: z.array(z.string()).optional(),
});
const GetDocsArgs = z.object({
  collection_name: z.string(),
  ids: z.array(z.string()).optional(),
  where: z.record(z.unknown()).optional(),
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
  include: z.array(z.string()).optional(),
});
const UpdateArgs = z.object({
  collection_name: z.string(),
  ids: z.array(z.string()),
  documents: z.array(z.string()).optional(),
  metadatas: z.array(z.record(z.unknown())).optional(),
  embeddings: z.array(z.array(z.number())).optional(),
});
const DeleteDocsArgs = z.object({
  collection_name: z.string(),
  ids: z.array(z.string()).optional(),
  where: z.record(z.unknown()).optional(),
});

const TOOLS = [
  {
    name: "chroma_list_collections",
    description: "List collections in the database with optional pagination.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "integer",
          description: "Maximum number of collections to return.",
        },
        offset: {
          type: "integer",
          description: "Number of collections to skip before returning results.",
        },
      },
      required: [] as string[],
    },
  },
  {
    name: "chroma_create_collection",
    description: "Create a new collection with optional metadata and embedding function.",
    inputSchema: {
      type: "object" as const,
      properties: {
        collection_name: {
          type: "string",
          description: "Name of the collection to create.",
        },
        metadata: {
          type: "object",
          description: "Metadata to associate with the collection.",
        },
        embedding_function_name: {
          type: "string",
          description: "Name of the embedding function to use for the collection.",
        },
      },
      required: ["collection_name"],
    },
  },
  {
    name: "chroma_peek_collection",
    description: "Return a preview of documents stored in a collection.",
    inputSchema: {
      type: "object" as const,
      properties: {
        collection_name: {
          type: "string",
          description: "Name of the collection to preview.",
        },
        limit: {
          type: "integer",
          description: "Maximum number of documents to preview.",
        },
      },
      required: ["collection_name"],
    },
  },
  {
    name: "chroma_get_collection_info",
    description: "Get metadata and configuration details for a collection.",
    inputSchema: {
      type: "object" as const,
      properties: {
        collection_name: {
          type: "string",
          description: "Name of the collection to get information for.",
        },
      },
      required: ["collection_name"],
    },
  },
  {
    name: "chroma_get_collection_count",
    description: "Get the number of records stored in a collection.",
    inputSchema: {
      type: "object" as const,
      properties: {
        collection_name: {
          type: "string",
          description: "Name of the collection to count records in.",
        },
      },
      required: ["collection_name"],
    },
  },
  {
    name: "chroma_modify_collection",
    description: "Rename a collection or replace its metadata.",
    inputSchema: {
      type: "object" as const,
      properties: {
        collection_name: {
          type: "string",
          description: "Name of the collection to modify.",
        },
        new_name: {
          type: "string",
          description: "New name for the collection.",
        },
        new_metadata: {
          type: "object",
          description: "New metadata to replace the collection's existing metadata.",
        },
      },
      required: ["collection_name"],
    },
  },
  {
    name: "chroma_delete_collection",
    description: "Delete a collection and all of its records.",
    inputSchema: {
      type: "object" as const,
      properties: {
        collection_name: {
          type: "string",
          description: "Name of the collection to delete.",
        },
      },
      required: ["collection_name"],
    },
  },
  {
    name: "chroma_add_documents",
    description: "Add documents with optional metadata and ids to a collection.",
    inputSchema: {
      type: "object" as const,
      properties: {
        collection_name: {
          type: "string",
          description: "Name of the collection to add documents to.",
        },
        documents: {
          type: "array",
          items: { type: "string" },
          description: "Document texts to add to the collection.",
        },
        metadatas: {
          type: "array",
          items: { type: "object" },
          description:
            "Metadata objects for each document, aligned by position with documents.",
        },
        ids: {
          type: "array",
          items: { type: "string" },
          description:
            "Ids for the documents, aligned by position with documents; generated when omitted.",
        },
      },
      required: ["collection_name", "documents"],
    },
  },
  {
    name: "chroma_query_documents",
    description: "Query a collection for documents nearest to the given query texts.",
    inputSchema: {
      type: "object" as const,
      properties: {
        collection_name: {
          type: "string",
          description: "Name of the collection to query.",
        },
        query_texts: {
          type: "array",
          items: { type: "string" },
          description: "Query texts to find the nearest documents for.",
        },
        n_results: {
          type: "integer",
          description: "Maximum number of results to return for each query text.",
        },
        where: {
          type: "object",
          description: "Metadata filter to apply to the query.",
        },
        where_document: {
          type: "object",
          description: "Document-content filter to apply to the query.",
        },
        include: {
          type: "array",
          items: { type: "string" },
          description:
            "Fields to include in the results, such as documents, metadatas, embeddings, or distances.",
        },
      },
      required: ["collection_name", "query_texts"],
    },
  },
  {
    name: "chroma_get_documents",
    description: "Retrieve documents from a collection by ids or filter.",
    inputSchema: {
      type: "object" as const,
      properties: {
        collection_name: {
          type: "string",
          description: "Name of the collection to retrieve documents from.",
        },
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Ids of the documents to retrieve.",
        },
        where: {
          type: "object",
          description: "Metadata filter selecting which documents to retrieve.",
        },
        limit: {
          type: "integer",
          description: "Maximum number of documents to return.",
        },
        offset: {
          type: "integer",
          description: "Number of documents to skip before returning results.",
        },
        include: {
          type: "array",
          items: { type: "string" },
          description:
            "Fields to include in the results, such as documents, metadatas, or embeddings.",
        },
      },
      required: ["collection_name"],
    },
  },
  {
    name: "chroma_update_documents",
    description: "Update documents, metadata, or embeddings for existing ids in a collection.",
    inputSchema: {
      type: "object" as const,
      properties: {
        collection_name: {
          type: "string",
          description: "Name of the collection containing the documents to update.",
        },
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Ids of the documents to update.",
        },
        documents: {
          type: "array",
          items: { type: "string" },
          description:
            "Replacement document texts, aligned by position with ids.",
        },
        metadatas: {
          type: "array",
          items: { type: "object" },
          description:
            "Replacement metadata objects, aligned by position with ids.",
        },
        embeddings: {
          type: "array",
          items: { type: "array", items: { type: "number" } },
          description:
            "Replacement embedding vectors, aligned by position with ids.",
        },
      },
      required: ["collection_name", "ids"],
    },
  },
  {
    name: "chroma_delete_documents",
    description: "Delete documents from a collection by ids or filter.",
    inputSchema: {
      type: "object" as const,
      properties: {
        collection_name: {
          type: "string",
          description: "Name of the collection to delete documents from.",
        },
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Ids of the documents to delete.",
        },
        where: {
          type: "object",
          description: "Metadata filter selecting which documents to delete.",
        },
      },
      required: ["collection_name"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "embedbase", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const client = new EmbedbaseClient(fetchFn);
  try {
    switch (name) {
      case "chroma_list_collections":
        return textResult(await client.listCollections(ListArgs.parse(args ?? {})));
      case "chroma_create_collection":
        return textResult(await client.createCollection(CreateArgs.parse(args ?? {})));
      case "chroma_peek_collection":
        return textResult(await client.peekCollection(PeekArgs.parse(args ?? {})));
      case "chroma_get_collection_info":
        return textResult(
          await client.getCollectionInfo(NameArgs.parse(args ?? {}).collection_name),
        );
      case "chroma_get_collection_count":
        return textResult(
          await client.getCollectionCount(NameArgs.parse(args ?? {}).collection_name),
        );
      case "chroma_modify_collection":
        return textResult(await client.modifyCollection(ModifyArgs.parse(args ?? {})));
      case "chroma_delete_collection":
        return textResult(
          await client.deleteCollection(NameArgs.parse(args ?? {}).collection_name),
        );
      case "chroma_add_documents":
        return textResult(await client.addDocuments(AddArgs.parse(args ?? {})));
      case "chroma_query_documents":
        return textResult(await client.queryDocuments(QueryArgs.parse(args ?? {})));
      case "chroma_get_documents":
        return textResult(await client.getDocuments(GetDocsArgs.parse(args ?? {})));
      case "chroma_update_documents":
        return textResult(await client.updateDocuments(UpdateArgs.parse(args ?? {})));
      case "chroma_delete_documents":
        return textResult(await client.deleteDocuments(DeleteDocsArgs.parse(args ?? {})));
    }
  } catch (err) {
    return errorResult(err);
  }
  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
