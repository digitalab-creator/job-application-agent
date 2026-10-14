import assert from "node:assert/strict";
import test from "node:test";
import {
  isDiscoveryBoardHubUrl,
  resolveDiscoveryBoardUrls,
} from "./resolve-discovery-boards.js";

test("naturalint /jobs/ hub is excluded from discovery board list", () => {
  assert.equal(isDiscoveryBoardHubUrl("https://www.naturalint.com/jobs/"), true);
  const boards = resolveDiscoveryBoardUrls({
    workspaceBoards: ["https://www.naturalint.com/jobs/"],
    envBoardsCsv: "",
    includeDefaultAtsBoards: false,
  });
  assert.equal(boards.length, 0);
});

test("Comeet company board and default Greenhouse boards merge without duplicates", () => {
  const comeet = "https://www.comeet.com/jobs/upwind/49.004";
  const boards = resolveDiscoveryBoardUrls({
    workspaceBoards: [comeet],
    envBoardsCsv: comeet,
    includeDefaultAtsBoards: true,
  });
  assert.ok(boards.includes(comeet));
  assert.ok(boards.some((url) => /boards\.greenhouse\.io\/similarweb/i.test(url)));
  assert.equal(boards.filter((url) => url === comeet).length, 1);
});
