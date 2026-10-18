import { test as base, expect } from "@playwright/test";
import { removeTrackedE2EAccounts } from "./session";

export { expect };
export const test = base;

test.afterEach(async () => {
  await removeTrackedE2EAccounts();
});
