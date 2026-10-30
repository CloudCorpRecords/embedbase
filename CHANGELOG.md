# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- CLI: `embedbase list [--limit n] [--offset n]`, `embedbase info <collection>`,
  `embedbase count <collection>`, and `embedbase mcp` for the stdio MCP server.
  The service URL comes from `CHROMA_URL` or `EMBEDBASE_URL`
  (default `http://localhost:8000`).
- MCP server with 12 tools covering collection lifecycle
  (list, create, peek, info, count, modify, delete) and document
  operations (add, query, get, update, delete).
- Core client talks to the Chroma HTTP API v2 tenant/database paths
  through an injectable fetch function, so all request shaping is
  testable offline with fakes.
