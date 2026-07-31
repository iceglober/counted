/**
 * Driving an SDK in another language.
 *
 * Each SDK ships a small `conformance` driver that speaks a line protocol on
 * stdin/stdout. The runner keeps every scenario, every assertion and every
 * comparison; a driver only translates commands into SDK calls and reports
 * what its fake transport saw. That split is deliberate — the alternative is
 * four scenario interpreters that can each be subtly wrong, which is the exact
 * failure this suite exists to prevent.
 *
 * The protocol, one JSON object per line:
 *
 *   in   {"cmd":"track","name":"a"}        {"cmd":"flush"}
 *        {"cmd":"advance","ms":5000}       {"cmd":"respond","status":429,...}
 *        {"cmd":"drain"}                   {"cmd":"shutdown"}
 *   out  {"ok":true}                       — every command is acknowledged
 *        {"requests":[{...}]}              — the answer to `drain`
 *
 * A driver is roughly a hundred lines. Everything hard stays here.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { CapturedRequest, Harness } from "./runner";

export type ProcessDriverSpec = {
  readonly language: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** Skip rather than fail when the toolchain is absent. */
  readonly available: () => boolean;
};

class LineProtocol {
  private buffer = "";
  private readonly waiting: ((line: string) => void)[] = [];

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consume(chunk));
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line.length > 0) {
        const resolve = this.waiting.shift();
        if (resolve !== undefined) resolve(line);
      }
      index = this.buffer.indexOf("\n");
    }
  }

  async send(message: unknown): Promise<Record<string, unknown>> {
    const reply = new Promise<string>((resolve, reject) => {
      this.waiting.push(resolve);
      // A driver that hangs must fail the scenario rather than the run.
      setTimeout(() => reject(new Error("driver did not reply within 5s")), 5_000).unref?.();
    });
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    return JSON.parse(await reply) as Record<string, unknown>;
  }
}

export const createProcessHarness = async (
  spec: ProcessDriverSpec,
): Promise<Harness & { stop(): Promise<void>; stderr(): string }> => {
  const child = spawn(spec.command, [...spec.args], { cwd: spec.cwd, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const protocol = new LineProtocol(child);
  const captured: CapturedRequest[] = [];

  /** Pull whatever the driver's fake transport has seen since last time. */
  const pull = async (): Promise<void> => {
    const reply = await protocol.send({ cmd: "drain" });
    const requests = (reply["requests"] ?? []) as CapturedRequest[];
    captured.push(...requests);
  };

  return {
    driver: {
      track: (name, properties) => {
        void protocol.send({ cmd: "track", name, properties: properties ?? null });
      },
      identify: (userId) => {
        void protocol.send({ cmd: "identify", userId });
      },
      reset: () => {
        void protocol.send({ cmd: "reset" });
      },
      flush: async () => {
        await protocol.send({ cmd: "flush" });
        await pull();
      },
      shutdown: async () => {
        await protocol.send({ cmd: "shutdown" });
        await pull();
      },
    },
    advance: async (ms) => {
      await protocol.send({ cmd: "advance", ms });
      await pull();
    },
    settle: async () => {
      await protocol.send({ cmd: "settle" });
      await pull();
    },
    drain: () => captured.splice(0, captured.length),
    enqueueResponse: (answer) => {
      // Fire and forget: the runner settles immediately afterwards, and the
      // driver acknowledges then.
      void protocol.send(
        answer === "network-error"
          ? { cmd: "respond", networkError: true }
          : { cmd: "respond", status: answer.status, headers: answer.headers ?? {}, body: answer.body ?? null },
      );
    },
    stop: async () => {
      child.stdin.end();
      child.kill();
    },
    stderr: () => stderr,
  };
};
