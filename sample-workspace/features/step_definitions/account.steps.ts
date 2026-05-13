import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { TestWorld } from '../support/world';

Given('a test account exists', async function (this: TestWorld) {
  expect(this.account).toBeDefined();
  expect(this.account!.email).toContain('@');
  expect(this.account!.password).toBeTruthy();
});

When('I assign the account role {string}', async function (this: TestWorld, role: string) {
  expect(this.account).toBeDefined();
  this.account!.role = role;
});

Then('the account should have role {string}', async function (this: TestWorld, role: string) {
  expect(this.account).toBeDefined();
  expect(this.account!.role).toBe(role);
});

Then('the account email should contain {string}', async function (this: TestWorld, emailDomain: string) {
  expect(this.account).toBeDefined();
  expect(this.account!.email).toContain(emailDomain);
});
