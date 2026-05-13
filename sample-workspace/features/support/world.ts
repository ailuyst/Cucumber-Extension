import { IWorldOptions, setWorldConstructor, World } from '@cucumber/cucumber';
import { Browser, BrowserContext, Page } from 'playwright';

type WorldParameters = {
  headless?: boolean;
};

export type TestAccount = {
  id: string;
  email: string;
  password: string;
  role: string;
};

export class TestWorld extends World<WorldParameters> {
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  account?: TestAccount;
  readonly headless: boolean;

  constructor(options: IWorldOptions<WorldParameters>) {
    super(options);
    this.headless = options.parameters.headless ?? true;
  }
}

setWorldConstructor(TestWorld);
