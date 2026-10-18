import assert from "node:assert/strict";
import test from "node:test";
import { deployVersionMismatch, resolveDeployAttestation } from "./run-export.js";

test("deployVersionMismatch flags configured vs running SHA drift", () => {
  const prevDeployed = process.env.DEPLOYED_GIT_SHA;
  const prevRunning = process.env.IMAGE_BUILD_GIT_SHA;
  process.env.DEPLOYED_GIT_SHA = "aaa";
  process.env.IMAGE_BUILD_GIT_SHA = "bbb";
  try {
    const att = resolveDeployAttestation();
    assert.equal(att.runningSha, "bbb");
    assert.equal(deployVersionMismatch(att), true);
  } finally {
    if (prevDeployed) {
      process.env.DEPLOYED_GIT_SHA = prevDeployed;
    } else {
      delete process.env.DEPLOYED_GIT_SHA;
    }
    if (prevRunning) {
      process.env.IMAGE_BUILD_GIT_SHA = prevRunning;
    } else {
      delete process.env.IMAGE_BUILD_GIT_SHA;
    }
  }
});
