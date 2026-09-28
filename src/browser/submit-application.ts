import type { Page } from "playwright";
import type { FormScope } from "./form-filler.js";

export type SubmitAttempt = {
  clicked: boolean;
  invalid: string[];
};

/**
 * Comeet's apply form lives in an iframe. The button is AngularJS `ng-click="apply()"`,
 * so a DOM click can leave the form on screen with no thank-you page.
 */
export async function submitApplication(page: Page, scope: FormScope): Promise<SubmitAttempt> {
  const frame = page.frames().find((item) => item.url().includes("/apply?"));
  const target: FormScope = frame ?? scope;
  return target.evaluate(() => {
    const angular = (window as unknown as {
      angular?: {
        element: (el: Element) => {
          triggerHandler: (name: string) => void;
          scope: () => { apply?: () => void; $apply: (fn: () => void) => void };
        };
      };
    }).angular;

    document.querySelectorAll("input, textarea, select").forEach((element) => {
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("blur", { bubbles: true }));
      angular?.element(element).triggerHandler("input");
      angular?.element(element).triggerHandler("change");
    });

    const invalid = Array.from(document.querySelectorAll("input.ng-invalid[required], textarea.ng-invalid[required], select.ng-invalid[required], input.ng-invalid-required"))
      .map((element) => (element as HTMLInputElement).name || element.getAttribute("aria-label") || "field")
      .filter((name) => name.length > 0);

    const button = Array.from(document.querySelectorAll("button")).find((element) => /submit application/i.test(element.textContent || ""));
    if (!button) {
      return { clicked: false, invalid: invalid.length > 0 ? invalid : ["submit_button_missing"] };
    }
    if (invalid.length > 0) {
      return { clicked: false, invalid };
    }
    if (angular) {
      const ngScope = angular.element(button).scope();
      if (typeof ngScope.apply === "function") {
        ngScope.$apply(() => {
          ngScope.apply?.();
        });
        return { clicked: true, invalid: [] };
      }
    }
    button.click();
    return { clicked: true, invalid: [] };
  });
}
