import { After, Before, setDefaultTimeout } from '@cucumber/cucumber';
import { chromium } from 'playwright';
import { TestAccount, TestWorld } from './world';

setDefaultTimeout(60_000);

Before({ tags: '@account' }, async function (this: TestWorld) {
  const uniqueId = Date.now().toString();
  const account: TestAccount = {
    id: `test-account-${uniqueId}`,
    email: `user-${uniqueId}@example.test`,
    password: 'Password123!',
    role: 'customer'
  };

  this.account = account;
});

Before(async function (this: TestWorld) {
  this.browser = await chromium.launch({ headless: this.headless });
  this.context = await this.browser.newContext({
    baseURL: 'https://playwright.dev'
  });
  this.page = await this.context.newPage();
});

After(async function (this: TestWorld) {
  await this.page?.close();
  await this.context?.close();
  await this.browser?.close();
});
