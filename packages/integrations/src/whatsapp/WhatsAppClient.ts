export interface WhatsAppClientConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion?: string;
  /** When false, `sendText` is a logged no-op and never calls Graph API. */
  enabled?: boolean;
}

export interface SendTextResult {
  messageId: string;
}

export class WhatsAppClient {
  private readonly baseUrl: string;

  constructor(private readonly config: WhatsAppClientConfig) {
    const version = config.apiVersion ?? "v21.0";
    this.baseUrl = `https://graph.facebook.com/${version}/${config.phoneNumberId}`;
  }

  isConfigured(): boolean {
    return Boolean(this.config.phoneNumberId && this.config.accessToken);
  }

  async sendText(to: string, body: string): Promise<SendTextResult> {
    if (this.config.enabled === false) {
      console.warn(
        `[whatsapp] send skipped to ${to.replace(/\D/g, "")}: WHATSAPP_ENABLED=false`,
      );
      return { messageId: "whatsapp-disabled" };
    }

    const recipient = to.replace(/\D/g, "");
    const text = body.length > 4096 ? `${body.slice(0, 4093)}...` : body;

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "text",
        text: { preview_url: false, body: text },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`WhatsApp API ${res.status}: ${errBody}`);
    }

    const data = (await res.json()) as {
      messages?: { id: string }[];
    };
    const messageId = data.messages?.[0]?.id ?? "unknown";
    return { messageId };
  }
}

export function createWhatsAppClient(config: WhatsAppClientConfig): WhatsAppClient {
  return new WhatsAppClient(config);
}
