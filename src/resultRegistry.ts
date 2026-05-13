export type CucumberItemDetailsKind = 'scenario' | 'exampleRow' | 'step';

export interface CucumberItemDetails {
  itemId: string;
  kind: CucumberItemDetailsKind;
  title: string;
  text: string;
  uri?: string;
  line?: number;
}

export class CucumberResultRegistry {
  private readonly items = new Map<string, CucumberItemDetails>();

  public clear(): void {
    this.items.clear();
  }

  public set(details: CucumberItemDetails): void {
    this.items.set(details.itemId, details);
  }

  public get(itemId: string | undefined): CucumberItemDetails | undefined {
    return itemId ? this.items.get(itemId) : undefined;
  }

  public hasResults(): boolean {
    return this.items.size > 0;
  }
}
