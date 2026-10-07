import assert from "node:assert/strict";
import test from "node:test";
import { classifyJobPage, isLoginWallUrl } from "./classify-page.js";

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

test("an explicit 404 stays closed even when the old role is still mentioned", () => {
  const status = classifyJobPage({
    url: "https://example.com/jobs/404",
    title: "Senior AI Engineer - Page not found",
    text: "The Senior AI Engineer position could not be found. 404.",
    role: "Senior AI Engineer",
  });
  assert.equal(status, "NOT_FOUND");
});

test("a removed role with a usable current-opening list is recoverable", () => {
  const status = classifyJobPage({
    url: "https://company.example/careers",
    title: "Careers",
    text: "The position has been closed. Search jobs and view current openings.",
    role: "Senior AI Engineer",
  });
  assert.equal(status, "CAREERS_PAGE");
});

test("a Workable not_found landing is a removed posting", () => {
  const status = classifyJobPage({
    url: "https://apply.workable.com/glassbox/?not_found=true",
    title: "Glassbox",
    text: "Glassbox is hiring. Browse our team and culture to learn more about working with us at Glassbox today.",
    role: "MarTech Lead",
  });
  assert.equal(status, "NOT_FOUND");
});

test("a LinkedIn authwall is a login wall, never a job page", () => {
  const status = classifyJobPage({
    url: "https://www.linkedin.com/authwall?trk=bf&sessionRedirect=https%3A%2F%2Fil.linkedin.com%2Fjobs%2Fview%2F1",
    title: "Sign Up | LinkedIn",
    text: "Join to view this job. Sign in to apply.",
    role: "Full-Stack AI Engineer",
  });
  assert.equal(status, "LOGIN_WALL");
});

test("login wall URLs are recognised without reading the page", () => {
  assert.equal(isLoginWallUrl("https://www.linkedin.com/authwall?trk=bf"), true);
  assert.equal(isLoginWallUrl("https://il.linkedin.com/jobs/view/123"), false);
});
