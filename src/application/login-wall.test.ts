import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeLoginWall } from "./login-wall.js";

test("password + sign-in copy is a login wall", () => {
  assert.equal(
    looksLikeLoginWall({
      url: "https://example.com/apply",
      text: "Please sign in to continue",
      hasPassword: true,
    }),
    true,
  );
});

test("iCIMS email gate with login URL is a login wall", () => {
  assert.equal(
    looksLikeLoginWall({
      url: "https://globalcareers-pepsico.icims.com/jobs/456938/login",
      title: "Login | General Data Protection Regulation (GDPR)",
      text: "Enter Your Information\nEmail\nI accept",
      hasPassword: false,
      hasEmail: true,
      hasResumeFile: false,
    }),
    true,
  );
});

test("Hebrew login modal with email and password is a login wall", () => {
  assert.equal(
    looksLikeLoginWall({
      url: "https://www.drushim.co.il/job/38354486/c0ea0b76/",
      text: "התחבר / הרשם\nמייל\nסיסמה",
      hasPassword: true,
      hasEmail: true,
      hasResumeFile: false,
    }),
    true,
  );
});

test("normal apply form with email and resume is not a login wall", () => {
  assert.equal(
    looksLikeLoginWall({
      url: "https://boards.greenhouse.io/acme/jobs/1",
      text: "Apply for this job\nEmail\nResume",
      hasPassword: false,
      hasEmail: true,
      hasResumeFile: true,
    }),
    false,
  );
});

test("job search page with no login cues is not a login wall", () => {
  assert.equal(
    looksLikeLoginWall({
      url: "https://www.pepsicojobs.com/main/jobs/456938",
      title: "Digital Growth & Analytics Marketing Sr. Director",
      text: "Apply Now\nJob Description",
      hasPassword: false,
      hasEmail: false,
      hasResumeFile: false,
    }),
    false,
  );
});
