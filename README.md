# trace-rote-exec

A successful agent run finds a tool path, then the chat goes away and the next run has to find that path again. This repo keeps the path.

It is four TypeScript functions: `captureTrace`, `deriveSteps`, `compileExec`, `assertReplay`. It is not [rote](https://www.modiqo.ai/faq) the product. There is no agent harness, no Play registry, and no LLM on the default path. Replay uses in-memory stubs.

Talk: [Turning agent traces into reusable executables with rote](https://www.youtube.com/watch?v=S_C9BZ0dhnE) (Roberts Pumpurs / Rust Poland).

This is not [atomic-verify-loop](https://github.com/Perk4/atomic-verify-loop). That repo isolates a reviewer from the implementer's story. This repo crystallizes a method. It is also not [feedback-issue-pr](https://github.com/Perk4/feedback-issue-pr), which turns a turn into an issue and a merge gate.

## Why the method has to leave the chat

rote records the work, not the private conversation. Failed attempts stay in the trace for review. The reusable executable drops them. Deterministic here means the same ordered tools and arguments. Fresh stub responses can still change the outputs.

## The four primitives

**`captureTrace(events)`.** Parse `{tool, args, ok, retry?, note?}` into a `Trace`. An event with a tool becomes an attempt. An event with only a note becomes chatter. Malformed events throw.

**`deriveSteps(trace)`.** Drop chatter. Drop failed paths. Consecutive attempts with the same tool and args, where the earlier one failed or set `retry`, collapse into the successful step. Notes that mention an assumption or a judgment become markers on that step.

**`compileExec(steps)`.** Return `{name, steps, fingerprint}`. `name` is the unique tools in first-seen order. `fingerprint` is the sha256 of the canonical JSON of `steps`. The name is a label. It is not in the hash.

**`assertReplay(exec, fixtureArgs)`.** Recompute the fingerprint. Call each step's stub. Compare outputs to `expectedOutputs`. A missing stub throws. The library does not invent a default.

```ts
import { assertReplay, captureTrace, compileExec, deriveSteps } from "./src/index.ts";

const trace = captureTrace([
  { note: "planning the fetch" },
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
    note: "assume json body",
  },
]);
const exec = compileExec(deriveSteps(trace));
const replay = assertReplay(exec, {
  stubs: {
    "http.get": () => ({ status: 200, n: 7 }),
  },
  expectedOutputs: [{ status: 200, n: 7 }],
});
```

`replay.outputs` is `[{ status: 200, n: 7 }]`. `replay.fingerprint` matches `exec.fingerprint`. The retry is one step.

## Run

```sh
npm install
npm test
npm run typecheck
```

`npm test` covers the happy path, one retry collapsed into a step, and fail-closed replay when a tool stub is missing.
