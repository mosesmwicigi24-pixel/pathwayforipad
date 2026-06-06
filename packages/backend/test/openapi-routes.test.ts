// Contract drift guard: every mounted Express route must appear in the OpenAPI
// paths, and vice versa (§3.7). Path-level parity (/v1 prefix stripped, :param →
// {param}). Catches a route added without updating the wire contract, or the reverse.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeApp } from "./helpers/app.js";

const here = dirname(fileURLToPath(import.meta.url));
const OPENAPI = join(here, "..", "..", "shared", "src", "openapi", "openapi.yaml");

/* eslint-disable @typescript-eslint/no-explicit-any */
function mountedPaths(app: any): Set<string> {
  const out = new Set<string>();
  const toOpenApi = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
  const walk = (stack: any[], prefix: string): void => {
    for (const layer of stack) {
      if (layer.route) {
        out.add(toOpenApi(prefix + layer.route.path));
      } else if (layer.name === "router" && layer.handle?.stack) {
        const m = /^\^\\\/((?:[^\\]|\\.)*?)\\\/\?/.exec(layer.regexp?.source ?? "");
        const mount = m ? "/" + m[1].replace(/\\(.)/g, "$1") : "";
        walk(layer.handle.stack, prefix + mount);
      }
    }
  };
  walk(app._router.stack, "");
  return out;
}

function openapiPaths(): Set<string> {
  const yaml = readFileSync(OPENAPI, "utf8");
  // Only the paths section: top-level keys under `paths:` that start with `/`.
  const section = yaml.slice(yaml.indexOf("\npaths:"), yaml.indexOf("\ncomponents:"));
  return new Set([...section.matchAll(/^ {2}(\/[^\s:]*):/gm)].map((mm) => mm[1]!));
}

describe("OpenAPI ↔ route parity (§3.7)", () => {
  it("every mounted route is documented and every documented path is mounted", () => {
    const app = makeApp();
    const routes = [...mountedPaths(app)]
      .map((p) => (p === "/v1" ? "" : p.startsWith("/v1/") ? p.slice(3) : p))
      .filter((p) => p.length > 0);

    const spec = openapiPaths();
    const routeSet = new Set(routes);

    const undocumented = [...routeSet].filter((p) => !spec.has(p));
    const unimplemented = [...spec].filter((p) => !routeSet.has(p));

    expect({ undocumented, unimplemented }).toEqual({ undocumented: [], unimplemented: [] });
  });
});
