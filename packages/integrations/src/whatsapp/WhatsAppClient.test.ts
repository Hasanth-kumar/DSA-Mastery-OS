import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppClient } from "./WhatsAppClient.js";

describe("WhatsApp send guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not call the Graph API when WHATSAPP_ENABLED=false", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new WhatsAppClient({
      phoneNumberId: "123",
      accessToken: "token",
      enabled: false,
    });

    const result = await client.sendText("15550001111", "hello");

    expect(result).toEqual({ messageId: "whatsapp-disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("WHATSAPP_ENABLED=false"));
  });
});
