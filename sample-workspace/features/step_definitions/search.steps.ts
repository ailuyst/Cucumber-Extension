import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { TestWorld } from '../support/world';

Given('I open the Playwright documentation site', async function (this: TestWorld) {
  await this.page!.goto('/');
  await expect(this.page!).toHaveTitle(/Playwright/);
});

When('I search for {string}', async function (this: TestWorld, query: string) {
  await this.page!.getByLabel('Search').click();
  await this.page!.getByRole('searchbox').fill(query);
});

Then('I should see search suggestions', async function (this: TestWorld) {
  await expect(this.page!.locator('.DocSearch-Dropdown')).toBeVisible();
});
