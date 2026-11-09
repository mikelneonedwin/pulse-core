import { PulseServer } from "./server";
import type { SerializedChannel } from "../types";

const server = new PulseServer();
const port = 4555;

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "POST" && url.pathname === "/api/v1/ingest") {
      const channel: SerializedChannel = await req.json();
      const res = server.ingestChannel(channel);
      return Response.json(res);
    }

    if (req.method === "POST" && url.pathname === "/api/v1/bot") {
      const body = await req.json();
      const { command, args = [], user = "engineer" } = body;
      const res = server.handleBotCommand(command, args, user);
      return Response.json(res);
    }

    if (req.method === "GET" && url.pathname === "/api/v1/incidents") {
      return Response.json(server.getIncidents());
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`[PulseServer] Central Hub running on http://127.0.0.1:${port}`);
