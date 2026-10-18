import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

test("gateway does not reference docker socket or docker log collector", () => {
  const indexSrc = fs.readFileSync(path.join(root, "../src/index.ts"), "utf8");
  assert.equal(indexSrc.includes("docker.sock"), false);
  assert.equal(indexSrc.includes("docker-logs"), false);
  const composeCandidates = [
    path.join(root, "../../docker-compose.yml"),
    path.join(root, "../docker-compose.yml"),
  ];
  const composePath = composeCandidates.find((candidate) => fs.existsSync(candidate));
  if (composePath) {
    const compose = fs.readFileSync(composePath, "utf8");
    const gatewayBlock = compose.split("jobagent-mcp-gateway:")[1]?.split("job-application-agent:")[0] ?? "";
    assert.equal(gatewayBlock.includes("docker.sock"), false);
  }
});
