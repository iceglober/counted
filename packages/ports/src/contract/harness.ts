/**
 * A tiny assertion harness, so the contract suites carry no test-framework
 * dependency.
 *
 * The suites are exported as plain data — a list of named async functions —
 * and each adapter's own test file wires them into whatever runner it uses:
 *
 *     for (const c of analyticalStoreContract) test(c.name, () => c.run(fixture));
 *
 * That keeps `packages/ports` importable from anywhere (the dependency rule
 * lets it reference only `@counted/domain`), and it means the same suite can
 * verify a Postgres adapter today and a ClickHouse one later without being
 * rewritten.
 */

export class ContractViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractViolation";
  }
}

const show = (v: unknown): string => {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

export const check = (condition: boolean, what: string): void => {
  if (!condition) throw new ContractViolation(what);
};

export const equal = <T>(actual: T, expected: T, what: string): void => {
  if (actual !== expected) {
    throw new ContractViolation(`${what}: expected ${show(expected)}, got ${show(actual)}`);
  }
};

export const deepEqual = <T>(actual: T, expected: T, what: string): void => {
  if (show(actual) !== show(expected)) {
    throw new ContractViolation(`${what}: expected ${show(expected)}, got ${show(actual)}`);
  }
};

export const closeTo = (actual: number, expected: number, epsilon: number, what: string): void => {
  if (!(Math.abs(actual - expected) <= epsilon)) {
    throw new ContractViolation(`${what}: expected ~${expected} (±${epsilon}), got ${actual}`);
  }
};

export const rejects = async (work: () => Promise<unknown>, what: string): Promise<unknown> => {
  try {
    await work();
  } catch (e) {
    return e;
  }
  throw new ContractViolation(`${what}: expected a rejection, got success`);
};

/** One requirement an adapter must satisfy. */
export type ContractCase<Fixture> = {
  readonly name: string;
  readonly run: (fixture: Fixture) => Promise<void>;
};
