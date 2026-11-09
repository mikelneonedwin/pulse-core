import { createHash } from "node:crypto";
import type { LogBreadcrumb, SerializedChannel, SeverityLevel } from "./types";

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

const LEVEL_COLOR: Record<string, string> = {
  log: ANSI.dim,
  info: ANSI.cyan,
  warn: ANSI.yellow,
  error: ANSI.red,
  alert: `${ANSI.bold}${ANSI.magenta}`,
};

export class Channel {
  readonly id: string;
  readonly title: string;
  readonly route: string;
  readonly startedAt: number;

  private attributes = new Map<string, string | string[]>();
  private breadcrumbs: LogBreadcrumb[] = [];
  private isClosed = false;
  private hasErrorState = false;
  private severityState: SeverityLevel = "low";
  private computedFingerprint?: string;

  constructor(options: { id?: string; title?: string; route?: string } = {}) {
    this.id = options.id ?? `ch_${Math.random().toString(36).slice(2, 9)}`;
    this.title = options.title ?? "Channel";
    this.route = options.route ?? "unknown";
    this.startedAt = Date.now();
  }

  set(key: string, value: string | number | boolean): this {
    this.attributes.set(key, String(value));
    return this;
  }

  append(key: string, value: string | number | boolean): this {
    const str = String(value);
    const existing = this.attributes.get(key);
    if (!existing) {
      this.attributes.set(key, str);
    } else if (Array.isArray(existing)) {
      existing.push(str);
    } else {
      this.attributes.set(key, [existing, str]);
    }
    return this;
  }

  get(key: string): string | string[] | undefined {
    return this.attributes.get(key);
  }

  log(message: string): this {
    return this.addBreadcrumb("log", message);
  }

  info(message: string): this {
    return this.addBreadcrumb("info", message);
  }

  warn(message: string): this {
    return this.addBreadcrumb("warn", message);
  }

  error(error: unknown, options?: { fingerprintBy?: string[]; severity?: SeverityLevel }): this {
    this.hasErrorState = true;
    this.severityState = options?.severity ?? "medium";

    const errorMsg = error instanceof Error ? error.message : String(error);
    this.addBreadcrumb("error", errorMsg);

    this.computedFingerprint = this.generateFingerprint(error, options?.fingerprintBy);
    return this;
  }

  alert(message: string, options?: { fingerprintBy?: string[] }): this {
    this.hasErrorState = true;
    this.severityState = "critical";
    this.addBreadcrumb("alert", message);

    this.computedFingerprint = this.generateFingerprint(message, options?.fingerprintBy);
    return this;
  }

  private addBreadcrumb(level: LogBreadcrumb["level"], message: string): this {
    this.breadcrumbs.push({
      offsetMs: Date.now() - this.startedAt,
      level,
      message,
      timestamp: Date.now(),
    });
    return this;
  }

  private generateFingerprint(err: unknown, fingerprintBy?: string[]): string {
    if (fingerprintBy && fingerprintBy.length > 0) {
      const parts: string[] = [];
      for (const key of fingerprintBy) {
        const val = this.attributes.get(key);
        if (val === undefined) {
          throw new Error(
            `Fingerprint error: key '${key}' was specified in fingerprintBy, but has not been set or appended to this channel.`
          );
        }
        parts.push(`${key}=${Array.isArray(val) ? val.join(",") : val}`);
      }
      return createHash("sha1").update(parts.join(":")).digest("hex").slice(0, 16);
    }

    const isErrorObj = err instanceof Error;
    const name = isErrorObj ? err.name : "LoggedError";
    const rawMsg = isErrorObj ? err.message : String(err);
    const normalizedMsg = rawMsg
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
      .replace(/\b\d+\b/g, "<num>");

    const topFrame = isErrorObj && err.stack ? err.stack.split("\n")[1]?.trim() ?? "" : "";
    const signature = `${this.route}|${name}|${normalizedMsg}|${topFrame}`;
    return createHash("sha1").update(signature).digest("hex").slice(0, 16);
  }

  print(width = 76): void {
    const durationMs = Date.now() - this.startedAt;
    const borderColor = this.hasErrorState ? ANSI.red : ANSI.green;
    const badge = this.hasErrorState ? "FAIL" : " OK ";
    const rightMeta = `${durationMs}ms ─ ${this.id}`;

    const innerWidth = width - 4;
    const padLine = (text: string, visibleLen: number) =>
      `${borderColor}│${ANSI.reset} ${text}${" ".repeat(Math.max(0, innerWidth - visibleLen))} ${borderColor}│${ANSI.reset}`;

    const divider = `${borderColor}├${"─".repeat(width - 2)}┤${ANSI.reset}`;
    const headerDashCount = Math.max(2, width - 10 - this.title.length - rightMeta.length);
    const topBorder = `${borderColor}╭─ ${ANSI.bold}${badge}${ANSI.reset}${borderColor} ${this.title} ${"─".repeat(headerDashCount)} ${rightMeta} ─╮${ANSI.reset}`;

    const lines: string[] = [topBorder];

    if (this.attributes.size > 0) {
      lines.push(padLine(`${ANSI.bold}Attributes${ANSI.reset}`, 10));
      const maxKeyLen = Math.max(...Array.from(this.attributes.keys()).map((k) => k.length), 8);

      for (const [k, v] of this.attributes.entries()) {
        const valStr = Array.isArray(v) ? `[${v.join(", ")}]` : v;
        const rawLine = `  ${k.padEnd(maxKeyLen)} : ${valStr}`;
        const truncated = rawLine.length > innerWidth ? rawLine.slice(0, innerWidth - 1) + "…" : rawLine;
        lines.push(padLine(truncated, truncated.length));
      }
    }

    if (this.breadcrumbs.length > 0) {
      if (this.attributes.size > 0) lines.push(divider);
      lines.push(padLine(`${ANSI.bold}Timeline${ANSI.reset}`, 8));

      for (const item of this.breadcrumbs) {
        const offset = `+${item.offsetMs}ms`.padEnd(8);
        const levelStr = item.level.toUpperCase().padEnd(6);
        const color = LEVEL_COLOR[item.level] ?? ANSI.reset;
        const prefixLen = 2 + 8 + 1 + 6 + 1;
        const maxMsgLen = innerWidth - prefixLen;
        const msg = item.message.length > maxMsgLen ? item.message.slice(0, maxMsgLen - 1) + "…" : item.message;

        const visibleLen = prefixLen + msg.length;
        const lineStr = `  ${ANSI.dim}${offset}${ANSI.reset} ${color}${levelStr}${ANSI.reset} ${msg}`;
        lines.push(padLine(lineStr, visibleLen));
      }
    }

    lines.push(`${borderColor}╰${"─".repeat(width - 2)}╯${ANSI.reset}`);
    process.stdout.write(lines.join("\n") + "\n");
  }

  toJSON(): SerializedChannel {
    const closedAt = Date.now();
    const attrs: Record<string, string | string[]> = {};
    for (const [k, v] of this.attributes.entries()) {
      attrs[k] = v;
    }

    return {
      id: this.id,
      title: this.title,
      route: this.route,
      hasError: this.hasErrorState,
      severity: this.severityState,
      fingerprint: this.computedFingerprint,
      attributes: attrs,
      breadcrumbs: [...this.breadcrumbs],
      startedAt: this.startedAt,
      closedAt,
      durationMs: closedAt - this.startedAt,
    };
  }

  close(): SerializedChannel {
    if (this.isClosed) {
      return this.toJSON();
    }
    this.isClosed = true;
    return this.toJSON();
  }
}
