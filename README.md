# embedbase

embedbase gives an agent — or you, at a terminal — a tidy way to work
with vector collections: create them, fill them with documents, and
query them for the closest matches. It speaks to a Chroma-compatible
HTTP service over its v2 REST API, so the embedding store stays a
separate process and this tool stays a thin, testable client.

Point it at a running service with `CHROMA_URL` or `EMBEDBASE_URL`
(without either, it assumes `http://localhost:8000`). Collections are
addressed by name at the MCP and CLI layers; internally the client
resolves each name to its server id before calling the id-scoped
document endpoints, exactly as the REST API requires.

## Install

```bash
npx @reneturcios/embedbase list
```

Or run the container image:

```bash
docker run -i ghcr.io/cloudcorprecords/embedbase
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead.

## CLI

```bash
# List collections (pagination is optional)
embedbase list --limit 20 --offset 0

# Inspect one collection, or count its records
embedbase info notes
embedbase count notes

# Create a collection
embedbase create notes

# Start the MCP server
embedbase mcp

embedbase --version
```

Exit codes: `0` on success, `1` when the service call fails (the error
includes the HTTP status), `2` for usage errors.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio MCP
server:

```bash
npx -y @reneturcios/embedbase mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "embedbase": {
      "command": "npx",
      "args": ["-y", "@reneturcios/embedbase", "mcp"],
      "env": { "CHROMA_URL": "http://localhost:8000" }
    }
  }
}
```

### Tools

All tools take `collection_name` (string) unless noted. Optional
parameters are omitted from the request when not supplied.

| Tool | Required | Optional | Purpose |
| --- | --- | --- | --- |
| `chroma_list_collections` | — | `limit`, `offset` (integers) | List collections with pagination. |
| `chroma_create_collection` | `collection_name` | `metadata` (object), `embedding_function_name` (string) | Create a collection. |
| `chroma_peek_collection` | `collection_name` | `limit` (integer) | Preview documents in a collection. |
| `chroma_get_collection_info` | `collection_name` | — | Collection metadata and configuration. |
| `chroma_get_collection_count` | `collection_name` | — | Number of records in a collection. |
| `chroma_modify_collection` | `collection_name` | `new_name`, `new_metadata` | Rename or re-tag a collection. |
| `chroma_delete_collection` | `collection_name` | — | Delete a collection and its records. |
| `chroma_add_documents` | `collection_name`, `documents` (string array) | `metadatas`, `ids` | Add documents; ids are generated deterministically when omitted. |
| `chroma_query_documents` | `collection_name`, `query_texts` (string array) | `n_results`, `where`, `where_document`, `include` | Nearest-neighbour query. |
| `chroma_get_documents` | `collection_name` | `ids`, `where`, `limit`, `offset`, `include` | Fetch documents by id or filter. |
| `chroma_update_documents` | `collection_name`, `ids` | `documents`, `metadatas`, `embeddings` | Update existing records. |
| `chroma_delete_documents` | `collection_name` | `ids`, `where` | Delete records by id or filter. |

Requests go to the v2 tenant/database paths
(`/api/v2/tenants/default_tenant/databases/default_database/collections...`).
Service errors come back as tool errors carrying the HTTP status —
results are never invented.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, fake fetch only, no live service
npm run dev     # run the CLI from source via tsx
```

The client core sits behind an injectable fetch function, which is
what the test suite drives: URL construction, request bodies,
id resolution, count unwrapping, and error surfacing are all covered
without a running server.

## License

MIT — see `LICENSE`.
