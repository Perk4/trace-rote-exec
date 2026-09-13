export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

export type ChatterEvent = {
  readonly kind: "chatter";
  readonly note: string;
};

export type AttemptEvent = {
  readonly kind: "attempt";
  readonly tool: string;
  readonly args: Json;
  readonly ok: boolean;
  readonly retry: boolean;
  readonly note?: string;
};

export type TraceEvent = ChatterEvent | AttemptEvent;

export type Trace = {
  readonly events: readonly TraceEvent[];
};

export type MarkerKind = "assumption" | "judgment";

export type Marker = {
  readonly kind: MarkerKind;
  readonly text: string;
};

export type Step = {
  readonly tool: string;
  readonly args: Json;
  readonly markers: readonly Marker[];
};

export type Executable = {
  readonly name: string;
  readonly steps: readonly Step[];
  readonly fingerprint: string;
};

export type ToolStub = (args: Json) => Json;

export type FixtureArgs = {
  readonly stubs: Readonly<Record<string, ToolStub>>;
  readonly expectedOutputs: readonly Json[];
};

export type ReplayReport = {
  readonly fingerprint: string;
  readonly outputs: readonly Json[];
};
