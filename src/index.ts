import { createHash } from "node:crypto";
import type {
  AttemptEvent,
  Executable,
  FixtureArgs,
  Json,
  Marker,
  ReplayReport,
  Step,
  Trace,
  TraceEvent,
} from "./types.ts";

export type {
  AttemptEvent,
  ChatterEvent,
  Executable,
  FixtureArgs,
  Json,
  Marker,
  MarkerKind,
  ReplayReport,
  Step,
  ToolStub,
  Trace,
  TraceEvent,
} from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJson(value: unknown): value is Json {
  if (value === null) {
    return true;
  }
  switch (typeof value) {
    case "boolean":
    case "string":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object": {
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
          if (!Object.hasOwn(value, index) || !isJson(value[index])) {
            return false;
          }
        }
        return true;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        return false;
      }
      return Object.values(value).every((child) => child !== undefined && isJson(child));
    }
    default:
      return false;
  }
}

function isJsonObject(value: Json): value is { readonly [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortJson(value: Json): Json {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (isJsonObject(value)) {
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child === undefined) {
        continue;
      }
      out[key] = sortJson(child);
    }
    return out;
  }
  return value.map(sortJson);
}

function parseJson(value: unknown): Json {
  if (!isJson(value)) {
    throw new Error("args must be JSON");
  }
  return sortJson(value);
}

function canonicalJson(value: Json): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (isJsonObject(value)) {
    const keys = Object.keys(value).sort();
    const fields = keys.map((key) => {
      const field = value[key];
      if (field === undefined) {
        throw new Error("canonical JSON cannot include undefined");
      }
      return `${JSON.stringify(key)}:${canonicalJson(field)}`;
    });
    return `{${fields.join(",")}}`;
  }
  return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
}

function jsonEqual(left: Json, right: Json): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function fingerprintOf(steps: readonly Step[]): string {
  const payload: Json = steps.map((step) => ({
    tool: step.tool,
    args: step.args,
    markers: step.markers.map((marker) => ({
      kind: marker.kind,
      text: marker.text,
    })),
  }));
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function parseEvent(value: unknown, index: number): TraceEvent {
  if (!isRecord(value)) {
    throw new Error(`event ${index} must be an object`);
  }
  const tool = value.tool;
  if (typeof tool === "string" && tool.length > 0) {
    if (typeof value.ok !== "boolean") {
      throw new Error(`event ${index} attempt requires boolean ok`);
    }
    const retry = value.retry === undefined ? false : value.retry;
    if (typeof retry !== "boolean") {
      throw new Error(`event ${index} retry must be a boolean`);
    }
    const note = value.note;
    if (note !== undefined && typeof note !== "string") {
      throw new Error(`event ${index} note must be a string`);
    }
    const args = value.args === undefined ? {} : parseJson(value.args);
    if (note === undefined) {
      return {
        kind: "attempt",
        tool,
        args,
        ok: value.ok,
        retry,
      };
    }
    return {
      kind: "attempt",
      tool,
      args,
      ok: value.ok,
      retry,
      note,
    };
  }
  if (typeof value.note === "string") {
    return { kind: "chatter", note: value.note };
  }
  throw new Error(`event ${index} needs a tool or a note`);
}

export function captureTrace(events: readonly unknown[]): Trace {
  return {
    events: events.map((event, index) => parseEvent(event, index)),
  };
}

function sameCall(left: AttemptEvent, right: AttemptEvent): boolean {
  return left.tool === right.tool && canonicalJson(left.args) === canonicalJson(right.args);
}

function markersFrom(note: string | undefined): readonly Marker[] {
  if (note === undefined) {
    return [];
  }
  const markers: Marker[] = [];
  if (/\bassum/i.test(note)) {
    markers.push({ kind: "assumption", text: note });
  }
  if (/\bjudg|\bdecid/i.test(note)) {
    markers.push({ kind: "judgment", text: note });
  }
  return markers;
}

function toStep(event: AttemptEvent): Step {
  return {
    tool: event.tool,
    args: event.args,
    markers: markersFrom(event.note),
  };
}

export function deriveSteps(trace: Trace): readonly Step[] {
  const steps: Step[] = [];
  let pending: AttemptEvent | undefined;
  for (const event of trace.events) {
    switch (event.kind) {
      case "chatter":
        break;
      case "attempt": {
        if (pending !== undefined && !sameCall(pending, event)) {
          if (pending.ok) {
            steps.push(toStep(pending));
          }
          pending = undefined;
        }
        if (!event.ok || event.retry) {
          pending = event;
          break;
        }
        pending = undefined;
        steps.push(toStep(event));
        break;
      }
      default: {
        const _exhaustive: never = event;
        throw new Error(`unknown event kind ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
  if (pending?.ok) {
    steps.push(toStep(pending));
  }
  return steps;
}

function execName(steps: readonly Step[]): string {
  const tools: string[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    if (!seen.has(step.tool)) {
      seen.add(step.tool);
      tools.push(step.tool);
    }
  }
  return tools.length === 0 ? "exec" : tools.join("→");
}

export function compileExec(steps: readonly Step[]): Executable {
  return {
    name: execName(steps),
    steps,
    fingerprint: fingerprintOf(steps),
  };
}

function outputsEqual(actual: readonly Json[], expected: readonly Json[]): boolean {
  if (actual.length !== expected.length) {
    return false;
  }
  return actual.every((item, index) => {
    const want = expected[index];
    return want !== undefined && jsonEqual(item, want);
  });
}

export function assertReplay(exec: Executable, fixtureArgs: FixtureArgs): ReplayReport {
  const fingerprint = fingerprintOf(exec.steps);
  if (fingerprint !== exec.fingerprint) {
    throw new Error("Fingerprint mismatch");
  }
  const outputs: Json[] = [];
  for (const step of exec.steps) {
    const stub = fixtureArgs.stubs[step.tool];
    if (stub === undefined) {
      throw new Error(`Missing stub for tool "${step.tool}"`);
    }
    outputs.push(stub(step.args));
  }
  if (!outputsEqual(outputs, fixtureArgs.expectedOutputs)) {
    throw new Error("Replay outputs do not match expectedOutputs");
  }
  return {
    fingerprint: exec.fingerprint,
    outputs,
  };
}
