export interface WorkClaims {
  claim(slug: string): boolean;
  release(slug: string): void;
  list(): readonly string[];
  complete(slug: string): void;
  isCompleted(slug: string): boolean;
  park(slug: string): void;
  unpark(slug: string): void;
  isParked(slug: string): boolean;
  listParked(): readonly string[];
}

export class InMemoryWorkClaims implements WorkClaims {
  private readonly activeSlugs = new Set<string>();
  private readonly completedSlugs = new Set<string>();
  private readonly parkedSlugs = new Set<string>();

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

  complete(slug: string): void {
    this.completedSlugs.add(slug);
  }

  isCompleted(slug: string): boolean {
    return this.completedSlugs.has(slug);
  }

  park(slug: string): void {
    this.parkedSlugs.add(slug);
  }

  unpark(slug: string): void {
    this.parkedSlugs.delete(slug);
  }

  isParked(slug: string): boolean {
    return this.parkedSlugs.has(slug);
  }

  listParked(): readonly string[] {
    return [...this.parkedSlugs];
  }
}
