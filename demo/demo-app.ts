import { PulseClient } from "../src/client";
import { spawn } from "node:child_process";
import { join } from "node:path";

async function isPortReachable(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthcheck`, { signal: AbortSignal.timeout(300) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(url: string, maxAttempts = 15): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(300) });
      if (res.status < 500) return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

const pulse = new PulseClient({
  apiKey: "pk_test_123",
  apiSecret: "secret_key_456",
  agentUrl: "http://127.0.0.1:4554",
  serviceName: "checkout-api",
  environment: "production",
});

async function simulateCheckout(user: string, shouldFail: boolean) {
  const ch = pulse.channel({
    title: "POST /api/checkout",
    route: "POST /api/checkout",
  });

  ch.set("user_id", user)
    .set("currency", "NGN")
    .set("cart_total", 45000)
    .set("flow", "checkout");

  ch.info("Verifying cart and user credentials");

  if (shouldFail) {
    ch.append("payment_gateway", "paystack");
    ch.warn("Payment attempt timed out from gateway");
    ch.append("payment_gateway", "retry_failed");
    ch.set("decline_code", "504_gateway_timeout");

    // Fingerprint by keys that are stored directly on the channel
    ch.error(new Error("Gateway declined: 504 Gateway Timeout"), {
      fingerprintBy: ["flow", "payment_gateway", "decline_code"],
      severity: "critical",
    });
  } else {
    ch.append("payment_gateway", "paystack");
    ch.info("Payment confirmed, receipt emitted");
  }

  // Print Winner's ASCII Box in terminal
  ch.print();

  // Flush to Ice's local daemon agent
  await pulse.flush(ch);
}

async function run() {
  const rootDir = join(import.meta.dir, "..");
  const childProcesses: ReturnType<typeof spawn>[] = [];

  const cleanup = () => {
    for (const proc of childProcesses) {
      try {
        proc.kill();
      } catch {}
    }
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  const hubOnline = await isPortReachable(4555);
  if (!hubOnline) {
    const hubProc = spawn("bun", ["run", "src/server/index.ts"], {
      cwd: rootDir,
      stdio: "pipe",
    });
    childProcesses.push(hubProc);
    await waitForServer("http://127.0.0.1:4555/api/v1/incidents");
  }

  const agentOnline = await isPortReachable(4554);
  if (!agentOnline) {
    const agentProc = spawn("./agent", [], {
      cwd: join(rootDir, "agent"),
      stdio: "pipe",
    });
    childProcesses.push(agentProc);
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log("\n--- SIMULATING USER TRAFFIC ---\n");
  await simulateCheckout("usr_winner_01", false);

  console.log("\n--- SIMULATING OUTAGE / REPEATED FAILURES ---\n");
  await simulateCheckout("usr_ice_02", true);
  await simulateCheckout("usr_john_03", true);
  await simulateCheckout("usr_kemi_04", true);

  console.log("\nWaiting for Go Agent batch flush to hub...\n");
  await new Promise((r) => setTimeout(r, 2000));

  console.log("\n--- SIMULATING SLACK/TELEGRAM BOT INTERACTION ---\n");
  const botRes1 = await fetch("http://127.0.0.1:4555/api/v1/bot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: "/status", user: "winner" }),
  });
  console.log("Bot Response (/status):\n", (await botRes1.json()).response);

  const incidentsRes = await fetch("http://127.0.0.1:4555/api/v1/incidents");
  const incidents = await incidentsRes.json();
  if (incidents.length > 0) {
    const incId = incidents[0].id;
    console.log(`\nAcknowledging Incident ${incId} via Bot (/ack)...`);
    const ackRes = await fetch("http://127.0.0.1:4555/api/v1/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "/ack", args: [incId], user: "icekid" }),
    });
    console.log("Bot Response (/ack):\n", (await ackRes.json()).response);
  }

  cleanup();
}

run();
