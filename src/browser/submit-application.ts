import type { Page } from "playwright";
import { greenhouseJobAppFrame } from "../application/greenhouse.js";
import { SUBMIT_LABEL_PATTERN } from "../application/submit-label.js";
import type { FormScope } from "./form-filler.js";

export type SubmitAttempt = {
  clicked: boolean;
  invalid: string[];
};

/**
 * Comeet's apply form lives in an iframe. The button is AngularJS `ng-click="apply()"`,
 * so a DOM click can leave the form on screen with no thank-you page.
 * Other sites, including Elementor career forms, use a normal Apply button.
 */
export async function submitApplication(page: Page, scope: FormScope): Promise<SubmitAttempt> {
  const frame = greenhouseJobAppFrame(page) ?? page.frames().find((item) => item.url().includes("/apply?"));
  const target: FormScope = frame ?? scope;
  const prepared = await target.evaluate((pattern) => {
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

    const invalid = Array.from(document.querySelectorAll("input, textarea, select"))
      .filter((element) => {
        const field = element as HTMLInputElement;
        if (field.disabled || field.type === "hidden" || field.type === "file" || field.type === "checkbox" || field.type === "radio") {
          return false;
        }
        if (field.value.trim().length > 0) {
          field.setCustomValidity("");
        }
        const angularInvalid = Boolean(angular) && field.classList.contains("ng-invalid") && (field.required || field.classList.contains("ng-invalid-required"));
        return (field.required && field.value.trim().length === 0) || (field.required && !field.checkValidity()) || angularInvalid;
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
        return { clicked: true, invalid: [], useDomClick: false };
      }
    }
    return { clicked: false, invalid: [], useDomClick: true };
  }, SUBMIT_LABEL_PATTERN);

  if (prepared.clicked || !prepared.useDomClick) {
    return { clicked: prepared.clicked, invalid: prepared.invalid };
  }
  const button = target.getByRole("button", { name: new RegExp(SUBMIT_LABEL_PATTERN, "i") }).first();
  try {
    await button.click({ timeout: 8000 });
  } catch {
    return { clicked: false, invalid: ["submit_button_missing"] };
  }
  return { clicked: true, invalid: [] };
}
