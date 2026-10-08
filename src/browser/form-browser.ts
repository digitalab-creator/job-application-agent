/**
 * Browser-only helpers for Playwright evaluate(). No Node imports — Playwright serializes these as-is.
 */

export type BrowserDetectedField = {
  index: number;
  tag: string;
  type: string;
  label: string;
  name: string;
  id: string;
  required: boolean;
  options: string[];
  groupLabel?: string;
};

export function readFieldsInBrowser(): BrowserDetectedField[] {
  const isVisibleControl = (element: Element): boolean => {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    if (element.getAttribute("aria-hidden") === "true") {
      return false;
    }
    const input = element as HTMLInputElement;
    if (input.tagName === "INPUT" && input.type === "hidden") {
      return false;
    }
    return true;
  };
  const deepQueryControls = (root: Document | ShadowRoot | Element): Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> => {
    const found: Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = [];
    const visit = (node: Document | ShadowRoot | Element) => {
      node.querySelectorAll("input, textarea, select").forEach((el) => {
        if (isVisibleControl(el)) {
          found.push(el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement);
        }
      });
      node.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) {
          visit(el.shadowRoot);
        }
      });
    };
    if (root instanceof Document) {
      visit(root);
    } else if (root instanceof ShadowRoot) {
      visit(root);
    } else {
      visit(root);
      if (root.shadowRoot) {
        visit(root.shadowRoot);
      }
    }
    return found;
  };
  const nodes = deepQueryControls(document);
  const fields: BrowserDetectedField[] = [];
  const seenKeys = new Set<string>();
  const textFromRefIds = (refIds: string | null) => {
    if (!refIds) {
      return "";
    }
    return refIds
      .split(/\s+/)
      .map((ref) => document.getElementById(ref)?.textContent?.replace(/\s+/g, " ").trim() ?? "")
      .filter(Boolean)
      .join(" ");
  };
  nodes.forEach((node, index) => {
    const el = node as HTMLInputElement;
    el.setAttribute("data-agent-field", String(index));
    const type = (el.getAttribute("type") || el.tagName).toLowerCase();
    if (type === "hidden" || type === "submit" || type === "button") {
      return;
    }
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return;
    }
    const id = el.id;
    const labelFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : "";
    const wrapped = el.closest("label")?.innerText ?? "";
    const aria = el.getAttribute("aria-label") ?? "";
    const labelledBy = textFromRefIds(el.getAttribute("aria-labelledby"));
    const describedBy = textFromRefIds(el.getAttribute("aria-describedby"));
    const container = el.closest(".field, .application-field, .form-group, .select__container, fieldset, [data-field]");
    const containerLabel = (container?.querySelector("label, legend, .label, .application-label, h3, h4")?.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();
    let raw = aria || labelledBy || labelFor || describedBy || containerLabel || el.placeholder || wrapped || el.name;
    if (!raw && /^question_/i.test(id)) {
      raw = container?.querySelector("label")?.textContent ?? "";
    }
    if (!raw && (type === "checkbox" || type === "radio")) {
      raw = el.getAttribute("value") ?? "";
    }
    const label = (raw || "").replace(/\s+/g, " ").trim().slice(0, 240);
    const dedupeKey = `${type}|${el.name || ""}|${label.slice(0, 100)}`;
    if (seenKeys.has(dedupeKey)) {
      return;
    }
    seenKeys.add(dedupeKey);
    const labelRequired = label.includes("*");
    const options = el.tagName === "SELECT"
      ? Array.from((el as unknown as HTMLSelectElement).options).map((option) => (option.textContent || "").trim()).filter(Boolean)
      : [];
    const group = el.closest(".elementor-field-group, fieldset");
    const groupLabel = (group?.querySelector(".elementor-field-label, legend")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240);
    fields.push({
      index,
      tag: el.tagName.toLowerCase(),
      type,
      label,
      name: el.name || "",
      id: el.id || "",
      required: el.required || el.getAttribute("aria-required") === "true" || labelRequired,
      options,
      groupLabel,
    });
  });
  return fields;
}

export function countFileInputsInBrowser(): number {
  const deepQueryControls = (root: Document | ShadowRoot | Element): Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> => {
    const found: Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = [];
    const visit = (node: Document | ShadowRoot | Element) => {
      node.querySelectorAll("input, textarea, select").forEach((el) => {
        found.push(el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement);
      });
      node.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) {
          visit(el.shadowRoot);
        }
      });
    };
    visit(root instanceof Document ? root : root);
    return found;
  };
  return deepQueryControls(document).filter((el) => el.tagName === "INPUT" && (el as HTMLInputElement).type === "file").length;
}

export function hasEmailInputInBrowser(): boolean {
  const deepQueryControls = (root: Document | ShadowRoot | Element): Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> => {
    const found: Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = [];
    const visit = (node: Document | ShadowRoot | Element) => {
      node.querySelectorAll("input, textarea, select").forEach((el) => {
        found.push(el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement);
      });
      node.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) {
          visit(el.shadowRoot);
        }
      });
    };
    visit(root instanceof Document ? root : root);
    return found;
  };
  return deepQueryControls(document).some((el) => el.tagName === "INPUT" && (el as HTMLInputElement).type === "email");
}

export function applicationFormScoreInBrowser(): number {
  const deepQueryControls = (root: Document | ShadowRoot | Element): Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> => {
    const found: Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = [];
    const visit = (node: Document | ShadowRoot | Element) => {
      node.querySelectorAll("input, textarea, select").forEach((el) => {
        found.push(el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement);
      });
      node.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) {
          visit(el.shadowRoot);
        }
      });
    };
    visit(root instanceof Document ? root : root);
    return found;
  };
  const controls = deepQueryControls(document);
  const text = controls.map((control) => {
    const element = control as HTMLInputElement;
    return [
      element.type,
      element.name,
      element.id,
      element.getAttribute("aria-label") ?? "",
      element.getAttribute("placeholder") ?? "",
      element.closest("label")?.textContent ?? "",
    ].join(" ");
  }).join(" ").toLowerCase();
  const body = (document.body?.innerText ?? "").toLowerCase();
  let score = 0;
  if (/\bresume\b|\bcv\b|curriculum/.test(text)) score += 10;
  if (controls.some((control) => (control as HTMLInputElement).type === "file")) score += 9;
  if (controls.some((control) => (control as HTMLInputElement).type === "email") || /\bemail\b/.test(text)) score += 7;
  if (/\bfirst.?name\b|\blast.?name\b|\bfull.?name\b/.test(text)) score += 6;
  if (/\bphone\b|\bmobile\b|\btelephone\b/.test(text)) score += 5;
  if (/linkedin|portfolio|github/.test(text)) score += 4;
  if (controls.some((control) => control.tagName.toLowerCase() === "textarea") || /question|experience|cover letter/.test(text)) score += 3;
  if (/\bapply\b|\bsubmit\b|application/.test(body)) score += 2;
  if (/\bsearch\b|\bnewsletter\b|\bsubscribe\b|\blogin\b|\bsign in\b/.test(text) && score < 12) score -= 8;
  return score + Math.min(controls.length, 10) / 10;
}
