import assert from "node:assert/strict";
import test from "node:test";
import { classifyJobPage } from "./classify-page.js";

test("an active Comeet posting is active", () => {
  const status = classifyJobPage({
    url: "https://www.comeet.com/jobs/stampli/example",
    title: "Senior Backend Engineer",
    text: "Senior Backend Engineer - AI/ML Systems. Apply for this job. Tel Aviv.",
    role: "Senior Backend Engineer - AI/ML Systems",
  });
  assert.equal(status, "ACTIVE_JOB");
});

test("a Hebrew apply page is an active job", () => {
  const status = classifyJobPage({
    url: "https://www.example.co.il/jobs/1",
    title: "משרה",
    text: "הגשת מועמדות למשרה בתל אביב. הצוות מחפש מועמד עם ניסיון בבניית מערכות, עבודה עם לקוחות, ומדידה. שלחו קו״ח דרך הטופס בעמוד זה.",
    role: "Data Engineer",
  });
  assert.equal(status, "ACTIVE_JOB");
});

test("a removed posting is closed", () => {
  const status = classifyJobPage({
    url: "https://www.comeet.com/jobs/stampli/example",
    title: "Stampli",
    text: "We're sorry, this position is no longer available.",
    role: "Senior Backend Engineer - AI/ML Systems",
  });
  assert.equal(status, "CLOSED");
});
