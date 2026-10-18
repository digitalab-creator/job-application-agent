import fs from "node:fs";
import path from "node:path";
import { nativeRunLogPath, type NativeRunLogEntry } from "../orchestration/native-run-log.js";
import { redactRecord } from "./redact.js";

function readNativeRuns(limit: number): NativeRunLogEntry[] {
  const file = nativeRunLogPath();
  if (!fs.existsSync(file)) {
    return [];
  }
  const lines = fs.readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  const parsed: NativeRunLogEntry[] = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line) as NativeRunLogEntry);
    } catch {
      // skip corrupt line
    }
  }
  return parsed.slice(-limit).reverse();
}

export function listRecentNativeRuns(limit: number): Record<string, unknown>[] {
  const bounded = Math.min(Math.max(1, limit), 100);
  return readNativeRuns(bounded).map((entry) => redactRecord(entry as unknown as Record<string, unknown>));
}

export type DeployAttestation = {
  deployedSha: string | null;
  source: string;
  releaseJsonPath: string | null;
  imageBuildSha: string | null;
};

function readShaFromReleaseJson(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const json = JSON.parse(fs.readFileSync(filePath, "utf8")) as { sha?: string };
    return json.sha?.trim() || null;
  } catch {
    return null;
  }
}

function candidateReleaseJsonPaths(): string[] {
  const paths: string[] = [];
  const fromEnv = process.env.DEPLOY_RELEASE_JSON_PATH?.trim();
  if (fromEnv) {
    paths.push(fromEnv);
  }
  paths.push("/app/tmp/deploy/latest-release.json");
  paths.push(path.join(process.cwd(), "tmp/deploy/latest-release.json"));
  return paths;
}

export function resolveDeployAttestation(): DeployAttestation {
  const fromEnv = process.env.DEPLOYED_GIT_SHA?.trim();
  if (fromEnv) {
    return {
      deployedSha: fromEnv,
      source: "env:DEPLOYED_GIT_SHA",
      releaseJsonPath: null,
      imageBuildSha: process.env.IMAGE_BUILD_GIT_SHA?.trim() || null,
    };
  }

  for (const filePath of candidateReleaseJsonPaths()) {
    const sha = readShaFromReleaseJson(filePath);
    if (sha) {
      return {
        deployedSha: sha,
        source: `release_json:${filePath}`,
        releaseJsonPath: filePath,
        imageBuildSha: process.env.IMAGE_BUILD_GIT_SHA?.trim() || null,
      };
    }
  }

  const imageBuild = process.env.IMAGE_BUILD_GIT_SHA?.trim();
  if (imageBuild) {
    return {
      deployedSha: imageBuild,
      source: "env:IMAGE_BUILD_GIT_SHA",
      releaseJsonPath: null,
      imageBuildSha: imageBuild,
    };
  }

  return {
    deployedSha: null,
    source: "unknown",
    releaseJsonPath: null,
    imageBuildSha: null,
  };
}

/** @deprecated use resolveDeployAttestation */
export function deployedShaFromEnv(): string | null {
  return resolveDeployAttestation().deployedSha;
}
