import { DocumentError } from "./objectStorage.js";
export interface DocumentDelivery {
  readonly configured: boolean;
  send(input: {
    id: string;
    email: string;
    subject: string;
    message: string;
    links: string[];
  }): Promise<{ providerMessageId: string }>;
}
export const deliveryUnavailable: DocumentDelivery = {
  configured: false,
  async send() {
    throw new DocumentError("DOCUMENT_EMAIL_NOT_CONFIGURED", 503);
  },
};
/** Reuses the existing Resend credential and sender; explicitly gated separately from password recovery. */
export function configuredDocumentDelivery(
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch
): DocumentDelivery {
  const key = env.RESEND_API_KEY,
    from = env.DOCUMENT_EMAIL_FROM ?? env.PASSWORD_RESET_FROM_EMAIL;
  if (env.DOCUMENT_EMAIL_ENABLED !== "true" || !key || !from)
    return deliveryUnavailable;
  return {
    configured: true,
    async send(input) {
      try {
        const result = await request("https://api.resend.com/emails", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
            "Idempotency-Key": "document/" + input.id,
          },
          body: JSON.stringify({
            from,
            to: [input.email],
            subject: input.subject,
            text:
              input.message +
              "\n\nPrivate document links (expire in 15 minutes; anyone with a link may open it):\n" +
              input.links.join("\n"),
          }),
        });
        if (!result.ok) {
          await result.body?.cancel();
          throw new Error();
        }
        const body = (await result.json()) as { id?: unknown };
        if (typeof body.id !== "string" || body.id.length > 200)
          throw new Error();
        return { providerMessageId: body.id };
      } catch {
        throw new DocumentError("DOCUMENT_SHARE_UNCONFIRMED", 503);
      }
    },
  };
}
