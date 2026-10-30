#!/usr/bin/env node
/**
 * embedbase CLI.
 *
 *   embedbase list [--limit n] [--offset n]
 *   embedbase info <collection>
 *   embedbase count <collection>
 *   embedbase create <collection>
 *   embedbase mcp
 *   embedbase --version
 *
 * Exit codes: 0 success, 1 service error, 2 usage error.
 * Service URL: CHROMA_URL or EMBEDBASE_URL (default http://localhost:8000).
 */
import { EmbedbaseClient, VERSION } from "./embed.js";
import type { FetchFn } from "./types.js";

function usage(): never {
  console.error(`Usage:
  embedbase list [--limit n] [--offset n]
  embedbase info <collection>
  embedbase count <collection>
  embedbase create <collection>
  embedbase mcp
  embedbase --version`);
  process.exit(2);
}

function flagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const client = new EmbedbaseClient(fetchFn);
  try {
    if (cmd === "list") {
      const limitRaw = flagValue(rest, "--limit");
      const offsetRaw = flagValue(rest, "--offset");
      const out = await client.listCollections({
        limit: limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : undefined,
        offset: offsetRaw !== undefined ? Number.parseInt(offsetRaw, 10) : undefined,
      });
      console.log(JSON.stringify(out, null, 2));
    } else if (cmd === "info") {
      const [name] = rest;
      if (!name) usage();
      console.log(JSON.stringify(await client.getCollectionInfo(name), null, 2));
    } else if (cmd === "count") {
      const [name] = rest;
      if (!name) usage();
      console.log(JSON.stringify(await client.getCollectionCount(name), null, 2));
    } else if (cmd === "create") {
      const [name] = rest;
      if (!name) usage();
      console.log(
        JSON.stringify(await client.createCollection({ collection_name: name }), null, 2),
      );
    } else {
      usage();
    }
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
