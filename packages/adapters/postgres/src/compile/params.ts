/**
 * Parameter accumulator.
 *
 * Every user-supplied value becomes a bound parameter. The only things that
 * ever reach the SQL string directly are identifiers from a closed set, and
 * those come from the domain's own union types rather than from a runtime
 * allowlist — v1 defended with `VALID_OPERATORS`-style arrays, and where one
 * was forgotten (retention's `date_trunc` unit) the check simply was not there.
 */
export class Params {
  private readonly values: unknown[] = [];

  /** Bind a value and return its placeholder. */
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }

  /** Bind many, returning a comma-separated placeholder list. */
  addAll(values: readonly unknown[]): string {
    return values.map((v) => this.add(v)).join(", ");
  }

  get all(): readonly unknown[] {
    return this.values;
  }

  get count(): number {
    return this.values.length;
  }
}
