export interface WorkClaims {
  claim(slug: string): boolean;
  release(slug: string): void;
  list(): readonly string[];
}

export class InMemoryWorkClaims implements WorkClaims {
  private readonly activeSlugs = new Set<string>();

  claim(slug: string): boolean {
    if (this.activeSlugs.has(slug)) return false;
    this.activeSlugs.add(slug);
    return true;
  }

  release(slug: string): void {
    this.activeSlugs.delete(slug);
  }

  list(): readonly string[] {
    return [...this.activeSlugs];
  }
}
