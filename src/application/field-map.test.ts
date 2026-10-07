import assert from "node:assert/strict";
import test from "node:test";
import { decideField } from "./field-map.js";

const ctx = {
  persona: "technical" as const,
  salaryMonthly: 32000,
  portfolioUrl: "https://digitalab.co.il/portfolio/?capability=build",
  euRole: false,
};

test("previous salary uses the verified monthly figure", () => {
  const decision = decideField({
    label: "What was your previous salary?",
    required: true,
    type: "text",
    options: [],
    ctx,
  });
  assert.equal(decision.action, "fill");
  if (decision.action === "fill") {
    assert.equal(decision.value, "ILS 25,000 gross/month");
    assert.equal(decision.source, "candidate_profile");
  }
});

test("a required degree question is blocked", () => {
  const decision = decideField({
    label: "What university degree do you hold?",
    required: true,
    type: "text",
    options: [],
    ctx,
  });
  assert.equal(decision.action, "block");
});

test("Greenhouse privacy combobox picks Yes", () => {
  const decision = decideField({
    label: "I agree to allow Orca Security to store and process my data for the purpose of considering my eligibility regarding my current application for employment.*",
    required: true,
    type: "text",
    options: [],
    ctx,
  });
  assert.equal(decision.action, "fill");
  if (decision.action === "fill") {
    assert.equal(decision.value, "Yes");
  }
});

test("Greenhouse third-party consent combobox picks Confirm", () => {
  const decision = decideField({
    label: "By submitting your application you consent to us sharing your information with a third party supporting us in this hiring process*",
    required: true,
    type: "text",
    options: [],
    ctx,
  });
  assert.equal(decision.action, "fill");
  if (decision.action === "fill") {
    assert.equal(decision.value, "Confirm");
  }
});

test("location-based questions use verified city and country", () => {
  const decision = decideField({
    label: "Where are you currently based?",
    required: true,
    type: "text",
    options: [],
    ctx,
  });
  assert.equal(decision.action, "fill");
  if (decision.action === "fill") {
    assert.equal(decision.value, "Petah Tikva, Israel");
    assert.equal(decision.source, "candidate_profile");
  }
});

test("Hebrew email label uses the candidate profile", () => {
  const decision = decideField({
    label: "מייל",
    required: true,
    type: "text",
    options: [],
    ctx,
  });
  assert.equal(decision.action, "fill");
  if (decision.action === "fill") {
    assert.equal(decision.value, "or.shvartz70@gmail.com");
    assert.equal(decision.source, "candidate_profile");
  }
});

test("Hunt PPC years, budget, platforms, and about-yourself are answered from the profile", () => {
  const years = decideField({
    label: "Years of hands-on PPC experience*",
    required: true,
    type: "select",
    options: ["Please select", "Less than 2 years", "2-5 years", "5+ years"],
    ctx,
  });
  assert.equal(years.action, "fill");
  if (years.action === "fill") {
    assert.equal(years.value, "5+ years");
  }

  const budget = decideField({
    label: "Media budget range you have managed simultaneously*",
    required: true,
    type: "select",
    options: ["Please select", "₪100,000 - ₪300,000", "₪300,000 - ₪600,000", "₪600,000+"],
    ctx,
  });
  assert.equal(budget.action, "fill");
  if (budget.action === "fill") {
    assert.equal(budget.value, "₪600,000+");
  }

  const platforms = decideField({
    label: "Which platforms have you worked with hands-on?*",
    required: true,
    type: "checkbox-group",
    options: ["Google", "Meta", "TikTok", "Taboola", "Outbrain", "Bing", "Yandex", "LinkedIn", "Other"],
    ctx,
  });
  assert.equal(platforms.action, "check-options");
  if (platforms.action === "check-options") {
    assert.ok(platforms.values.includes("Google"));
    assert.ok(platforms.values.includes("Bing"));
    assert.equal(platforms.values.includes("TikTok"), false);
    assert.ok(platforms.values.includes("Other"));
  }

  const about = decideField({
    label: "Tell us about yourself:",
    required: false,
    type: "textarea",
    options: [],
    ctx: { ...ctx, persona: "marketing", otherPlatformsText: "X, ChatGPT Ads, Snapchat, Traffic Junky, Mantis" },
  });
  assert.equal(about.action, "llm");

  const other = decideField({
    label: "Other - please specify",
    required: false,
    type: "text",
    options: [],
    ctx: { ...ctx, otherPlatformsText: "X, ChatGPT Ads, Snapchat, Traffic Junky, Mantis" },
  });
  assert.equal(other.action, "fill");
  if (other.action === "fill") {
    assert.match(other.value, /ChatGPT Ads/);
    assert.match(other.value, /Mantis/);
  }
});

test("expected salary for this senior role stays at the top of the band", () => {
  const decision = decideField({
    label: "Expected salary",
    required: true,
    type: "text",
    options: [],
    ctx,
  });
  assert.equal(decision.action, "fill");
  if (decision.action === "fill") {
    assert.equal(decision.value, "ILS 32,000 gross/month");
  }
});

test("privacy policy checkbox with long label is checked", () => {
  const decision = decideField({
    label: "I read and understood the privacy policy*",
    required: true,
    type: "checkbox",
    options: [],
    ctx,
  });
  assert.equal(decision.action, "check");
});

test("empty label resolves from name=name to full name", () => {
  const decision = decideField({
    label: "",
    name: "name",
    required: true,
    type: "text",
    options: [],
    ctx,
  });
  assert.equal(decision.action, "fill");
  if (decision.action === "fill") {
    assert.equal(decision.value, "Or Shvartz");
  }
});

test("country phone code selects Israel not full mobile number", () => {
  const decision = decideField({
    label: "country phone code",
    name: "country_phone_code",
    required: true,
    type: "select",
    options: ["Select", "+972 (Israel)", "+1 (US)"],
    ctx,
  });
  assert.equal(decision.action, "fill");
  if (decision.action === "fill") {
    assert.equal(decision.value, "+972 (Israel)");
  }
});

test("country phone code never invents a full phone-number answer", () => {
  const decision = decideField({
    label: "country phone code",
    name: "country_phone_code",
    required: true,
    type: "select",
    options: ["Select", "+1 (US)", "+44 (UK)"],
    ctx,
  });
  assert.equal(decision.action, "block");
});

test("unknown required CRM fields are blocked instead of receiving invented facts", () => {
  const decision = decideField({
    label: "",
    name: "hubspot__estimated_monthly_orders",
    required: true,
    type: "text",
    options: [],
    ctx,
  });
  assert.equal(decision.action, "block");
  if (decision.action === "block") {
    assert.match(decision.reason, /estimated monthly orders/i);
  }
});

test("LLM experience yes/no uses verified years", () => {
  const decision = decideField({
    label: "Do you have 3+ years of production LLM serving experience?",
    required: true,
    type: "select",
    options: ["Yes", "No"],
    ctx,
  });
  assert.equal(decision.action, "fill");
  if (decision.action === "fill") {
    assert.equal(decision.value, "Yes");
  }
});

test("Guidde-style UA years and budget fill as text when there are no dropdown options", () => {
  const years = decideField({
    label:
      "How many years of hands-on experience do you have managing user acquisition campaigns end-to-end (Search, Performance Max, Display, YouTube)?*",
    required: true,
    type: "text",
    options: [],
    ctx: { ...ctx, persona: "marketing" },
  });
  assert.equal(years.action, "fill");
  if (years.action === "fill") {
    assert.equal(years.value, "12");
  }

  const budget = decideField({
    label: "What is the largest monthly paid media budget you've managed independently?*",
    required: true,
    type: "text",
    options: [],
    ctx: { ...ctx, persona: "marketing" },
  });
  assert.equal(budget.action, "fill");
  if (budget.action === "fill") {
    assert.match(budget.value, /1,500,000/);
  }
});

test("primary paid media focus and human-reason use verified screening profile", () => {
  const focus = decideField({
    label: "Which best describes your primary paid media focus?*",
    required: true,
    type: "select",
    options: ["Brand awareness", "Full-funnel growth", "Enterprise B2B only"],
    ctx: { ...ctx, persona: "marketing" },
  });
  assert.equal(focus.action, "fill");
  if (focus.action === "fill") {
    assert.equal(focus.value, "Full-funnel growth");
  }

  const reasonTech = decideField({
    label: "human-reason",
    required: true,
    type: "textarea",
    options: [],
    ctx,
  });
  assert.equal(reasonTech.action, "fill");
  if (reasonTech.action === "fill") {
    assert.match(reasonTech.value, /Applied AI engineer/);
  }

  const reasonMkt = decideField({
    label: "human-reason",
    required: true,
    type: "textarea",
    options: [],
    ctx: { ...ctx, persona: "marketing" },
  });
  assert.equal(reasonMkt.action, "fill");
  if (reasonMkt.action === "fill") {
    assert.match(reasonMkt.value, /Performance marketing/);
  }
});

test("how did you hear prefers LinkedIn option", () => {
  const decision = decideField({
    label: "How did you hear about this job?",
    required: true,
    type: "select",
    options: ["Employee referral", "LinkedIn", "Other"],
    ctx,
  });
  assert.equal(decision.action, "fill");
  if (decision.action === "fill") {
    assert.equal(decision.value, "LinkedIn");
  }
});

test("Tel Aviv office commute several days per week answers Yes", () => {
  const decision = decideField({
    label: "Are you comfortable commuting to our Tel Aviv office location three days a week?",
    required: true,
    type: "select",
    options: ["Yes", "No"],
    ctx,
  });
  assert.equal(decision.action, "fill");
  if (decision.action === "fill") {
    assert.equal(decision.value, "Yes");
  }
});

test("Haifa office commute skips the job", () => {
  const decision = decideField({
    label: "Are you comfortable commuting to our Haifa office three days a week?",
    required: true,
    type: "select",
    options: ["Yes", "No"],
    ctx,
  });
  assert.equal(decision.action, "skip_job");
});

test("BI analytics 1-10 scale uses grounded self rating", () => {
  const decision = decideField({
    label:
      "On a scale of 1-10, 10 being expert level, how would you rate your BI/analytics tools (Looker, Tableau, Amplitude, etc.) and SQL skills?*",
    required: true,
    type: "text",
    options: [],
    ctx,
  });
  assert.equal(decision.action, "fill");
  if (decision.action === "fill") {
    assert.match(decision.value, /^[78]$/);
  }
});
