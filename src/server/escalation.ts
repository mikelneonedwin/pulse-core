import type { IncidentReport, SerializedChannel } from "../types";

export interface NotificationEvent {
  channelType: "slack" | "telegram" | "whatsapp" | "voice";
  destination: string;
  message: string;
  incidentId: string;
}

export class EscalationDispatcher {
  async dispatch(event: NotificationEvent): Promise<void> {
    const timestamp = new Date().toISOString();
    console.log(
      `\x1b[35m[DISPATCH ${timestamp}] -> Channel: ${event.channelType.toUpperCase()} | Dest: ${event.destination}\x1b[0m\n` +
      `  Incident: ${event.incidentId}\n` +
      `  Payload : ${event.message}\n`
    );
  }

  async triggerEscalationStep(incident: IncidentReport, step: number): Promise<void> {
    const channels = step === 1 
      ? ["slack", "telegram"] as const 
      : ["whatsapp", "voice"] as const;

    for (const ch of channels) {
      await this.dispatch({
        channelType: ch,
        destination: ch === "voice" ? "+234-HOTLINE-TECH" : "#alerts-critical",
        incidentId: incident.id,
        message: `[ALERT Step ${step}] ${incident.occurrences}x failures on ${incident.route}: ${incident.latestMessage} (Users: ${incident.affectedUsers.join(", ")})`,
      });
    }
  }
}
