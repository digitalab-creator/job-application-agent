import type { Page } from "playwright";
import { greenhouseJobAppFrame } from "../application/greenhouse.js";
import { SUBMIT_LABEL_PATTERN } from "../application/submit-label.js";
import { candidate } from "../config/candidate.js";
import type { FormScope } from "./form-filler.js";
import { syncPhoneInputs } from "./form-filler.js";

export type SubmitAttempt = {
  clicked: boolean;
  invalid: string[];
  advanced?: boolean;
};

/**
 * Comeet's apply form lives in an iframe. The button is AngularJS `ng-click="apply()"`,
 * so a DOM click can leave the form on screen with no thank-you page.
 * Other sites, including Elementor career forms, use a normal Apply button.
 */
export async function submitApplication(page: Page, scope: FormScope): Promise<SubmitAttempt> {
  const target: FormScope = await preferredSubmitScope(page, scope);
  await syncPhoneInputs(target);
  const phoneLocal = candidate.phone.local.replace(/\D/g, "");
  const prepared = await target.evaluate(({ pattern, phoneLocal: localPhone }) => {
    const rule = new RegExp(pattern, "i");
    const angular = (window as unknown as {
      angular?: {
        element: (el: Element) => {
          triggerHandler: (name: string) => void;
          scope: () => { apply?: () => void; $apply: (fn: () => void) => void };
        };
      };
    }).angular;

    const shouldSyncField = (field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
      if (field.disabled || field.type === "hidden" || field.type === "file" || field.type === "checkbox" || field.type === "radio") {
        return false;
      }
      return true;
    };

    if (angular) {
      document.querySelectorAll("input, textarea, select").forEach((element) => {
        const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        if (!shouldSyncField(field)) {
          return;
        }
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
        field.dispatchEvent(new Event("blur", { bubbles: true }));
        angular.element(field).triggerHandler("input");
        angular.element(field).triggerHandler("change");
      });
    }

    const isVisibleField = (field: HTMLInputElement) => {
      const style = window.getComputedStyle(field);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
      if (field.getAttribute("aria-hidden") === "true") {
        return false;
      }
      return true;
    };

    document.querySelectorAll('input[name="phone"], input.iti__tel-input, input[type="tel"]').forEach((element) => {
      const input = element as HTMLInputElement;
      if (input.value.trim().length > 0) {
        return;
      }
      input.value = localPhone;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const phoneHasValue = (field: HTMLInputElement) => {
      if (field.name === "phone" && field.value.trim().length === 0 && localPhone) {
        field.value = localPhone;
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (field.value.trim().length > 0) {
        return true;
      }
      const tel = (window as unknown as {
        intlTelInputGlobals?: { getInstance?: (node: HTMLInputElement) => { getNumber?: () => string; isValidNumber?: () => boolean } | null };
      }).intlTelInputGlobals?.getInstance?.(field);
      const number = tel?.getNumber?.() ?? "";
      if (number.trim().length > 0) {
        field.value = number;
        return true;
      }
      return Boolean(tel?.isValidNumber?.());
    };

    const invalid = Array.from(document.querySelectorAll("input, textarea, select"))
      .filter((element) => {
        const field = element as HTMLInputElement;
        if (field.disabled || field.type === "hidden" || field.type === "file" || field.type === "checkbox" || field.type === "radio") {
          return false;
        }
        if (!isVisibleField(field)) {
          return false;
        }
        if (phoneHasValue(field) || field.value.trim().length > 0) {
          field.setCustomValidity("");
        }
        const angularInvalid = Boolean(angular) && field.classList.contains("ng-invalid") && (field.required || field.classList.contains("ng-invalid-required"));
        const emptyRequired = field.required && !phoneHasValue(field) && field.value.trim().length === 0;
        return emptyRequired || (field.required && !field.checkValidity()) || angularInvalid;
      })
      .map((element) => {
        const field = element as HTMLInputElement;
        const name = field.name || field.getAttribute("aria-label") || "field";
        return `${name} (${field.validationMessage || "empty"})`;
      })
      .filter((name) => name.length > 0);

    const button = Array.from(document.querySelectorAll("button, input[type='submit']")).find((element) => {
      const label = (element.textContent || (element as HTMLInputElement).value || "").replace(/\s+/g, " ").trim();
      return rule.test(label);
    });
    if (!button) {
      const next = Array.from(document.querySelectorAll("button, a")).find((element) => {
        const label = (element.textContent || (element as HTMLInputElement).value || "").replace(/\s+/g, " ").trim();
        return /^(next|continue|save and continue|continue application)$/i.test(label);
      });
      if (next && invalid.length === 0) {
        (next as HTMLElement).click();
        return { clicked: true, invalid: [], advanced: true, useDomClick: false };
      }
      return { clicked: false, invalid: invalid.length > 0 ? invalid : ["submit_button_missing"], useDomClick: false };
    }
    if ((button as HTMLButtonElement).disabled) {
      return { clicked: false, invalid: ["submit_disabled"], useDomClick: false };
    }
    if (invalid.length > 0) {
      return { clicked: false, invalid, useDomClick: false };
    }
    if (angular) {
      const ngScope = angular.element(button).scope();
      if (ngScope && typeof ngScope.apply === "function") {
        ngScope.$apply(() => {
          ngScope.apply?.();
        });
      }
    }
    try {
      (button as HTMLButtonElement).click();
    } catch {
      return { clicked: false, invalid: [], useDomClick: true };
    }
    return { clicked: true, invalid: [], advanced: false, useDomClick: false };
  }, { pattern: SUBMIT_LABEL_PATTERN, phoneLocal });

  if (prepared.clicked || !prepared.useDomClick) {
    if (!prepared.clicked && prepared.invalid.some((item) => item === "submit_button_missing")) {
      const shadowClick = await clickSubmitViaPlaywright(page, target);
      if (shadowClick) {
        return { clicked: true, invalid: [], advanced: false };
      }
    }
    return { clicked: prepared.clicked, invalid: prepared.invalid, advanced: prepared.advanced };
  }
  const button = target.getByRole("button", { name: new RegExp(SUBMIT_LABEL_PATTERN, "i") }).first();
  try {
    await button.click({ timeout: 8000 });
  } catch {
    const shadowClick = await clickSubmitViaPlaywright(page, target);
    if (shadowClick) {
      return { clicked: true, invalid: [], advanced: false };
    }
    return { clicked: false, invalid: ["submit_button_missing"] };
  }
  return { clicked: true, invalid: [], advanced: false };
}

/** SmartRecruiters oneclick-ui renders controls inside shadow roots; light-DOM evaluate misses Submit. */
async function clickSubmitViaPlaywright(page: Page, scope: FormScope): Promise<boolean> {
  const scopes: FormScope[] = [scope, page, ...page.frames()];
  const namePattern = /submit|send application|apply for this job|apply now/i;
  for (const candidate of scopes) {
    const button = candidate.getByRole("button", { name: namePattern }).first();
    if (await button.count().catch(() => 0)) {
      await button.click({ timeout: 10_000 }).catch(() => undefined);
      return true;
    }
  }
  return false;
}

async function preferredSubmitScope(page: Page, scope: FormScope): Promise<FormScope> {
  if (await hasSubmitOrNext(scope)) {
    return scope;
  }
  const greenhouse = greenhouseJobAppFrame(page);
  if (greenhouse && await hasSubmitOrNext(greenhouse)) {
    return greenhouse;
  }
  const applyFrame = page.frames().find((item) => item.url().includes("/apply?"));
  return applyFrame && await hasSubmitOrNext(applyFrame) ? applyFrame : scope;
}

async function hasSubmitOrNext(scope: FormScope): Promise<boolean> {
  return scope.locator("button, input[type='submit'], a").evaluateAll((elements) => elements.some((element) => {
    const label = (element.textContent || (element as HTMLInputElement).value || "").replace(/\s+/g, " ").trim();
    return new RegExp(SUBMIT_LABEL_PATTERN, "i").test(label)
      || /^(next|continue|save and continue|continue application)$/i.test(label);
  })).catch(() => false);
}
