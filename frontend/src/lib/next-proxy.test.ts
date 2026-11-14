import assert from "node:assert/strict";
import { test } from "node:test";
import config from "../../next.config.ts";

test("offer search and lookup have backend proxy routes", async () => {
  assert.equal(typeof config.rewrites, "function");
  const rewrites = await config.rewrites!();
  assert.ok(Array.isArray(rewrites));
  for (const path of [
    "domains",
    "campaign-groups",
    "traffic-sources",
    "offers",
    "offers/:id",
    "campaigns",
    "campaigns/:id",
    "campaigns/:id/push",
  ]) {
    const source = `/api/v1/integrations/keitaro/${path}`;
    const rewrite: { source: string; destination: string } | undefined =
      rewrites.find((rule) => rule.source === source);
    assert.ok(rewrite, `Missing proxy route for ${source}`);
    const destination: URL = new URL(rewrite.destination);
    assert.equal(
      destination.origin,
      new URL(process.env.ADROBOT_BACKEND_ORIGIN ?? "http://127.0.0.1:8000")
        .origin,
    );
    assert.equal(destination.pathname, source);
    assert.equal(destination.search, "");
  }
});
