export type SeverityLevel = "low" | "medium" | "high" | "critical";

export interface LogBreadcrumb {
  offsetMs: number;
  level: "log" | "info" | "warn" | "error" | "alert";
  message: string;
  timestamp: number;
}

export interface ChannelOptions {
  title?: string;
  route?: string;
  ttlMs?: number;
}

export interface SerializedChannel {
  id: string;
  title: string;
  route: string;
  hasError: boolean;
  severity: SeverityLevel;
  fingerprint?: string;
  attributes: Record<string, string | string[]>;
  breadcrumbs: LogBreadcrumb[];
  startedAt: number;
  closedAt: number;
  durationMs: number;
}

export interface IncidentReport {
  id: string;
  fingerprint: string;
  route: string;
  status: "open" | "in_progress" | "resolved" | "irrelevant";
  occurrences: number;
  firstSeenAt: number;
  lastSeenAt: number;
  latestMessage: string;
  affectedUsers: string[];
  channels: SerializedChannel[];
  escalationStep: number;
  acknowledgedBy?: string;
}

export interface EscalationPolicy {
  steps: {
    delaySeconds: number;
    channels: Array<"slack" | "telegram" | "whatsapp" | "voice">;
  }[];
}
