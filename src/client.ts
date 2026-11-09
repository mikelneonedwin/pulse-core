import { Channel } from "./channel";
import type { SerializedChannel } from "./types";

export interface PulseClientOptions {
  apiKey: string;
  apiSecret: string;
  agentUrl?: string;
  serviceName: string;
  environment?: string;
}

export class PulseClient {
  private apiKey: string;
  private apiSecret: string;
  private agentUrl: string;
  private serviceName: string;
  private environment: string;

  constructor(options: PulseClientOptions) {
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
    this.agentUrl = options.agentUrl ?? "http://127.0.0.1:4554";
    this.serviceName = options.serviceName;
    this.environment = options.environment ?? "production";
  }

  channel(options: { title?: string; route?: string } = {}): Channel {
    const ch = new Channel(options);
    ch.set("service", this.serviceName);
    ch.set("env", this.environment);
    return ch;
  }

  async flush(channel: Channel): Promise<void> {
    const payload: SerializedChannel = channel.close();
    try {
      const res = await fetch(`${this.agentUrl}/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Pulse-Key": this.apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.error(`[PulseClient] Ingest returned HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn(`[PulseClient] Warning: Failed to deliver channel to local agent: ${(err as Error).message}`);
    }
  }
}
