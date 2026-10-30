# embedbase — Build Report

MCP Rebuild 100. Clean-room rebuild of the Chroma MCP server
(chroma-core/chroma-mcp), built from the public tool spec captured in
`harness/fixtures/chroma-tools-original.json` only. The fixture was
created for this build: it is docs-derived from the original
project's public documentation (tool names, parameter types,
required sets), marked `"_source": docs-derived ... not hand-probed`.
Local build only — nothing pushed or published, and no live network
call was made or claimed at any point.

Identity: repo `embedbase`, npm `@reneturcios/embedbase`,
MCP name `io.github.CloudCorpRecords/embedbase`, version `0.1.0`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `embedbase: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Vector collections and document
  search backed by a Chroma HTTP service." = **71 chars** (≤100 ✓);
  npm entry carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/embedbase:0.1.0` carries **no** `version`
  field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/embedbase"`
- `tsconfig.json` (copied from pgport / fleet template), `.gitignore`,
  `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios), `README.md`
  (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/cli.ts` (`list`, `info`, `count`, `create`,
  `mcp`, `--version`; exit 2 usage / 1 service error), `src/mcp.ts`,
  `src/types.ts`, `src/embed.ts` (core logic, `VERSION = "0.1.0"`)
- `test/embed.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (from the fleet template; image name and smoke-test server name
  changed to embedbase)

## Implementation notes

- 12 MCP tools, exactly as spec'd: collection lifecycle
  (`chroma_list_collections`, `chroma_create_collection`,
  `chroma_peek_collection`, `chroma_get_collection_info`,
  `chroma_get_collection_count`, `chroma_modify_collection`,
  `chroma_delete_collection`) and documents
  (`chroma_add_documents`, `chroma_query_documents`,
  `chroma_get_documents`, `chroma_update_documents`,
  `chroma_delete_documents`), each with the spec's exact inputSchema.
- **Low-level Server API, with reason:** `src/mcp.ts` registers the
  tools via `Server` from `@modelcontextprotocol/sdk/server/index.js`
  with explicit inputSchema literals, not McpServer+zod — the
  high-level path injects `$schema` / `additionalProperties` and caps
  parity (standing rule from Wave 1). Zod still validates every
  `tools/call` argument set internally.
- Core client (`EmbedbaseClient`) talks to the Chroma HTTP API v2
  paths under
  `/api/v2/tenants/default_tenant/databases/default_database/collections`.
  Base URL from `EMBEDBASE_URL` / `CHROMA_URL`, default
  `http://localhost:8000`. Name-addressed calls resolve the
  collection id with a GET on the collection resource, then use the
  documented id-scoped endpoints (`/add`, `/query`, `/get`,
  `/update`, `/delete`, `/count`); peek is a bounded `/get`.
  `addDocuments` generates deterministic ids (`doc-<index>`) when
  none are supplied; `getCollectionCount` unwraps both bare-number
  and `{count}` response shapes.
- All HTTP goes through an injectable `FetchFn` (types.ts). The test
  suite drives a fake fetch that records URLs/methods/bodies —
  **no live Chroma service exists in this VM and none was called**,
  so behaviour against a real server is unverified (see Gaps).

## Verification (exact outputs)

### 1. Build
```
$ ./node_modules/.bin/tsc ; echo exit=$?
tsc exit=0
```
`dist/` produced (cli.js with `#!/usr/bin/env node` shebang,
embed.js, mcp.js, index.js, types.js, plus .d.ts/.js.map).
Note: tsc emit initially failed with EPERM from the VM's
intermittent exec write guard (0-byte dist files); after the guard
cleared, a plain `./node_modules/.bin/tsc` run produced the final
dist with exit 0, and `tsc --noEmit` also exits 0. The shipped dist
is unmodified tsc output.

### 2. Tests
```
$ ./node_modules/.bin/tsx --test test/*.test.ts
ℹ tests 20
ℹ pass 20
ℹ fail 0
```
Covers: base-URL resolution (default, EMBEDBASE_URL > CHROMA_URL,
trailing-slash trim), list with/without pagination params, create
body shaping + empty-name rejection before any request, info GET,
count id-resolution + endpoint + numeric unwrap, delete by name,
modify id-resolution + PUT body, peek bounded get, add (explicit
ids, generated ids), query (filters + n_results default 10), get,
update, delete-documents request bodies, HTTP-error surfacing with
status, transport-failure surfacing, and missing-id error.

### 3. CLI / MCP smoke (live, this VM)
```
--version -> 0.1.0 (exit 0); unknown command -> Usage (exit 2)
MCP initialize/tools/list exercised by the parity harness below:
12 tools, serverInfo name "embedbase", version "0.1.0".
No tools/call against a live Chroma was run (no service in VM).
```

### 4. Parity (harness)
```
$ python3 ~/workspace/mcp-rebuild-100/harness/parity.py \
    --original ~/workspace/mcp-rebuild-100/harness/fixtures/chroma-tools-original.json \
    --rebuild "stdio:node /home/hatch/workspace/mcp-rebuild-100/builds/embedbase/dist/cli.js mcp" \
    --out ~/workspace/mcp-rebuild-100/builds/embedbase/parity-out
verdict=PASS parity_pct=100.0 original_tools=12 rebuild_tools=12 missing=[] extra=[] schema_diffs=[]
(exit 0)
```
`parity-out/parity.json` on disk confirms: verdict PASS,
parity_pct 100.0, identical_tools 12. `fixture_results:
SKIPPED-TOOLS-FILE-MODE` — expected harness semantics for a
tools-file original, not an error.

## Lockfile status

`package-lock.json` was copied from pgport with identity fields
edited (top-level `name`, root package `name`, and root package
`bin` key pgport -> embedbase; dependency ranges are identical, so
the tree is unchanged). **Clean regeneration (no `node_modules`
present) is REQUIRED before publish** — fleet lesson in
TEMPLATE.md §2 item 6; do not publish from this lockfile as-is.
`node_modules` in this build dir is a `cp -a` copy of pgport's
(local build only, gitignored; ownership-preservation warnings
during the copy were cosmetic).

## Blockers / honest gaps

- **No live Chroma service in this VM:** request shaping, id
  resolution, and response handling are covered by fake-fetch unit
  tests only. Behaviour parity against a real Chroma server (exact
  REST payload acceptance, e.g. modify via PUT on the id resource,
  count response shape) is NOT claimed — parity here is
  tool/schema parity (12/12, 100.0%) against a docs-derived fixture.
- **Docs-derived ground truth:** the fixture is labelled
  docs-derived, not hand-probed, in its `_source`. Re-probe a live
  original where network allows (SCOREBOARD Blocker 1 family).
- Container build not exercised locally; the publish-container
  workflow smoke-tests the image at publish time.
- mcpaudit / mcpvet / shipcheck pre-publish gate not run — that
  belongs to the publish wave, not claimed here.

## Publish-gate remediation (2026-10-27)

Recorded under Rene's 2026-10-27 decision ("Remediate the 6: add param
descriptions + capability-class vet policy, then re-gate") and
`publish/GATE-POLICY.md`, applied to embedbase as a follow-on unit.
This is an authorized deviation from the parity-faithful state:
descriptions were added to every tool parameter that lacked one, in
the `src/mcp.ts` schema literals only — parameter names, types,
required lists and enums are unchanged. The standing schema-only
parity gap (no live Chroma service in the VM) is unchanged.

- Descriptions added: 37 insertion points, covering all 37 served
  parameter occurrences across the 12 tools (the served schemas are
  per-tool literals, so insertion points and served occurrences
  coincide; no shared schema consts are used in the served literals).
- Rebuild: `npm run build` (tsc) exit 0; `tsc --noEmit` exit 0; full
  test suite 20/20 pass.
- Parity harness re-run, verbatim: **PARTIAL, parity_pct 50.0** —
  all 37 schema diffs are description additions
  (`*.description: present in rebuild but not in original`;
  0 structural diffs). Structural parity proven independently under
  the coordinator-validated strip procedure: stripping `description`
  keys from BOTH the post-remediation and pre-remediation tools/list
  deep-equals (strip-both-equal: true); every description present
  pre-remediation is byte-identical post-remediation
  (changed-descriptions: 0, removed-descriptions: 0), and the only
  additions are the 37 at inputSchema property paths
  (non-property-additions: 0). Adjudication: the description-only
  diffs are the authorized remediation itself; structural parity is
  unchanged. Full record:
  `publish/parity-remediation/embedbase/parity.json`,
  `publish/parity-remediation/embedbase/tools-pre.json`,
  `publish/parity-remediation/embedbase/tools-post.json`,
  `publish/parity-remediation/embedbase/strip-proof.py`,
  `publish/parity-remediation/embedbase/strip-proof.txt`.
