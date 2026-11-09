# Pulse Core (Merged Observability & Incident Platform)

A working prototype demonstrating the merge of **Winner's** developer-first wide-event channel engine with **Ice's** resilient Go daemon agent and multi-channel incident escalation pipeline.

## Architecture

1. **Application Layer (Winner)**: [src/channel.ts](file:///home/winner/workspace/pulse-core/src/channel.ts)
   - Request-scoped `Channel` primitive.
   - Header-style attributes (`.set()` and `.append()`).
   - Breadcrumb timeline (`.log()`, `.info()`, `.warn()`, `.error()`, `.alert()`).
   - Deterministic structural fingerprinting.
   - Atomic ANSI/Unicode box logger (`.print()`).

2. **Reliability & Transport Daemon (Ice)**: [agent/main.go](file:///home/winner/workspace/pulse-core/agent/main.go)
   - Compiled Go daemon listening on `localhost:4554`.
   - Append-only local segment log for offline and crash resilience.
   - Non-blocking batch forwarding to central server with HMAC signatures.

3. **Central Hub & Incident Escalation (Merged)**: [src/server/server.ts](file:///home/winner/workspace/pulse-core/src/server/server.ts) & [src/server/escalation.ts](file:///home/winner/workspace/pulse-core/src/server/escalation.ts)
   - Ingests channels, deduplicates by structural fingerprint.
   - Aggregates affected users and error volume.
   - Automated escalation across Slack, Telegram, WhatsApp, and hotline calls.
   - Chatbot interface supporting `/status`, `/ack <id>`, and `/resolve <id>`.

## Running the Prototype

```bash
# Terminal 1: Start Central Server
bun run src/server/index.ts

# Terminal 2: Start Go Daemon Agent
cd agent && ./agent

# Terminal 3: Run Simulated Traffic and Bot Interaction
bun run demo/demo-app.ts
```
