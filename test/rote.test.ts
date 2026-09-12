import { describe, expect, it } from "vitest";
import { assertReplay, captureTrace, compileExec, deriveSteps } from "../src/index.ts";
import type { ReplayReport, Step } from "../src/types.ts";

describe("trace-rote-exec", () => {
  it("captures a successful path, drops chatter, and replays it", () => {
    const trace = captureTrace([
      { note: "planning the fetch" },
      {
        tool: "http.get",
        args: { url: "https://api.example.com/n" },
        ok: true,
        note: "assume json body",
      },
      {
        tool: "write",
        args: { path: "n.json" },
        ok: true,
        note: "judgment: persist",
      },
    ]);
    const steps = deriveSteps(trace);
    expect(steps).toEqual([
      {
        tool: "http.get",
        args: { url: "https://api.example.com/n" },
        markers: [{ kind: "assumption", text: "assume json body" }],
      },
      {
        tool: "write",
        args: { path: "n.json" },
        markers: [{ kind: "judgment", text: "judgment: persist" }],
      },
    ] satisfies Step[]);
    const exec = compileExec(steps);
    expect(exec.name).toBe("http.get→write");
    const replay = assertReplay(exec, {
      stubs: {
        "http.get": () => ({ status: 200, n: 7 }),
        write: () => ({ written: true }),
      },
      expectedOutputs: [{ status: 200, n: 7 }, { written: true }],
    });
    expect(replay).toEqual({
      fingerprint: exec.fingerprint,
      outputs: [{ status: 200, n: 7 }, { written: true }],
    } satisfies ReplayReport);
    expect(exec.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("collapses one retry into a single step", () => {
    const steps = deriveSteps(
      captureTrace([
        {
          tool: "http.get",
          args: { url: "https://api.example.com/n" },
          ok: false,
          retry: true,
        },
        {
          tool: "http.get",
          args: { url: "https://api.example.com/n" },
          ok: true,
        },
      ]),
    );
    expect(steps).toEqual([
      {
        tool: "http.get",
        args: { url: "https://api.example.com/n" },
        markers: [],
      },
    ] satisfies Step[]);
    const exec = compileExec(steps);
    const replay = assertReplay(exec, {
      stubs: {
        "http.get": () => ({ status: 200, n: 7 }),
      },
      expectedOutputs: [{ status: 200, n: 7 }],
    });
    expect(replay.outputs).toEqual([{ status: 200, n: 7 }]);
    expect(replay.fingerprint).toBe(exec.fingerprint);
  });

  it("fails closed when a step has no tool stub", () => {
    const exec = compileExec([
      {
        tool: "ghost",
        args: {},
        markers: [],
      },
    ]);
    expect(() =>
      assertReplay(exec, {
        stubs: {},
        expectedOutputs: [],
      }),
    ).toThrow('Missing stub for tool "ghost"');
  });
});
