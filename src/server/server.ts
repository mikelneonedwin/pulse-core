import type { IncidentReport, SerializedChannel } from "../types";
import { EscalationDispatcher } from "./escalation";

export class PulseServer {
  private incidents = new Map<string, IncidentReport>();
  private dispatcher = new EscalationDispatcher();
  private errorThreshold = 3;

  ingestChannel(channel: SerializedChannel): { status: string; incidentId?: string } {
    if (!channel.hasError) {
      return { status: "recorded_ok" };
    }

    const fingerprint = channel.fingerprint ?? `err_${channel.route}`;
    let incident = this.incidents.get(fingerprint);

    const userId = typeof channel.attributes.user_id === "string" 
      ? channel.attributes.user_id 
      : "anonymous";

    const errorBreadcrumb = channel.breadcrumbs.slice().reverse().find(b => b.level === "error" || b.level === "alert");
    const latestMsg = errorBreadcrumb ? errorBreadcrumb.message : "Unknown error";

    if (!incident) {
      incident = {
        id: `inc_${Math.random().toString(36).slice(2, 8)}`,
        fingerprint,
        route: channel.route,
        status: "open",
        occurrences: 1,
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
        latestMessage: latestMsg,
        affectedUsers: [userId],
        channels: [channel],
        escalationStep: 0,
      };
      this.incidents.set(fingerprint, incident);
    } else {
      if (incident.status === "resolved") {
        incident.status = "open";
        incident.escalationStep = 0;
      }
      incident.occurrences += 1;
      incident.lastSeenAt = Date.now();
      incident.latestMessage = latestMsg;
      if (!incident.affectedUsers.includes(userId)) {
        incident.affectedUsers.push(userId);
      }
      incident.channels.push(channel);
    }

    if (channel.severity === "critical" || incident.occurrences >= this.errorThreshold) {
      if (incident.escalationStep === 0) {
        incident.escalationStep = 1;
        this.dispatcher.triggerEscalationStep(incident, 1);
      }
    }

    return { status: "ingested", incidentId: incident.id };
  }

  handleBotCommand(command: string, args: string[], user: string): { response: string } {
    const action = command.toLowerCase();

    if (action === "/status" || action === "/issues") {
      const open = Array.from(this.incidents.values()).filter(i => i.status !== "resolved");
      if (open.length === 0) {
        return { response: "All systems healthy. No active incidents." };
      }
      const summary = open.map(i => `• ${i.id} [${i.status.toUpperCase()}]: ${i.occurrences}x on ${i.route} - ${i.latestMessage}`).join("\n");
      return { response: `Active Incidents:\n${summary}` };
    }

    if (action === "/ack") {
      const incidentId = args[0];
      const incident = Array.from(this.incidents.values()).find(i => i.id === incidentId);
      if (!incident) return { response: `Incident ${incidentId} not found.` };

      incident.status = "in_progress";
      incident.acknowledgedBy = user;
      return { response: `Incident ${incident.id} acknowledged by @${user}. Escalation paused.` };
    }

    if (action === "/resolve") {
      const incidentId = args[0];
      const incident = Array.from(this.incidents.values()).find(i => i.id === incidentId);
      if (!incident) return { response: `Incident ${incidentId} not found.` };

      incident.status = "resolved";
      return { response: `Incident ${incident.id} marked as RESOLVED by @${user}.` };
    }

    return { response: `Unknown command: ${command}. Try /status, /ack <id>, or /resolve <id>.` };
  }

  getIncidents(): IncidentReport[] {
    return Array.from(this.incidents.values());
  }
}
