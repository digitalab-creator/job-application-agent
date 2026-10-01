export type JobPageStatus = "ACTIVE_JOB" | "CLOSED" | "NOT_FOUND" | "CAREERS_PAGE" | "UNKNOWN";

const CLOSED = /no longer (available|accepting)|position (has been |is )?closed|this job has expired|no longer accepting applications|position has been filled|job (is )?not available|we're sorry, but there are currently no open positions/i;
const NOT_FOUND = /\b404\b|page not found|job not found/i;
const CAREERS = /open positions|see all (jobs|positions)|view all jobs|careers at/i;

export function classifyJobPage(input: {
  url: string;
  title: string;
  text: string;
  role: string;
}): JobPageStatus {
  const blob = `${input.title}\n${input.text}`;
  if (/hello-theme|\/themes\/|\/plugins\//i.test(input.url) && !roleMentioned(input.role, blob)) {
    return "NOT_FOUND";
  }
  if (/error=true/i.test(input.url) && !roleMentioned(input.role, blob)) {
    return "NOT_FOUND";
  }
  if (NOT_FOUND.test(blob) && !roleMentioned(input.role, blob)) {
    return "NOT_FOUND";
  }
  if (CLOSED.test(blob)) {
    return "CLOSED";
  }
  if (blob.trim().length < 80) {
    return "UNKNOWN";
  }
  if (roleMentioned(input.role, blob) || /apply|הגש(?:ת)? מועמדות|שלח(?:ו)? קו|לחץ להגשה/i.test(blob)) {
    return "ACTIVE_JOB";
  }
  if (CAREERS.test(blob)) {
    return "CAREERS_PAGE";
  }
  return "UNKNOWN";
}

function roleMentioned(role: string, text: string): boolean {
  const words = role
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3);
  if (words.length === 0) {
    return false;
  }
  const haystack = text.toLowerCase();
  const hits = words.filter((word) => haystack.includes(word)).length;
  return hits >= Math.ceil(words.length / 2);
}
