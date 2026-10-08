import assert from "node:assert/strict";
import test from "node:test";
import {
  extractComeetEmbeddedText,
  formatGreenhouseJobText,
  resolveGreenhouseApiTarget,
} from "./fetch-posting-text.js";

test("extractComeetEmbeddedText pulls Requirements bullets from embedded JSON", () => {
  const html = `
    <html><body>
    {"name": "Requirements", "value": "\\u003Cul\\u003E\\u003Cli\\u003E5+ years JavaScript\\u003C/li\\u003E\\u003Cli\\u003EReact and TypeScript\\u003C/li\\u003E\\u003C/ul\\u003E"}
    </body></html>`;
  const text = extractComeetEmbeddedText(html);
  assert.match(text, /Requirements/i);
  assert.match(text, /JavaScript/i);
  assert.match(text, /React/i);
});

test("resolveGreenhouseApiTarget resolves company-site gh_jid links", () => {
  const target = resolveGreenhouseApiTarget(
    "https://www.payoneer.com/careers/position/8156113/?gh_jid=8156113",
  );
  assert.ok(target);
  assert.equal(target?.slug, "payoneer");
  assert.equal(target?.jobId, "8156113");
});

test("formatGreenhouseJobText strips HTML content", () => {
  const text = formatGreenhouseJobText({
    title: "Backend Engineer",
    content: "<p>5+ years <strong>Node.js</strong></p>",
    location: { name: "Tel Aviv" },
  });
  assert.match(text, /Backend Engineer/);
  assert.match(text, /Node\.js/);
  assert.match(text, /Tel Aviv/);
});
