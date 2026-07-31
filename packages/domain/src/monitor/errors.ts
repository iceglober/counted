export type MonitorError =
  | { kind: "NameRequired" }
  | { kind: "NegativeCooldown" }
  | { kind: "AnalysisMustBeScalar" }
  | { kind: "InvalidAnalysis"; detail: string }
  | { kind: "AlreadyEnabled" }
  | { kind: "AlreadyDisabled" };
