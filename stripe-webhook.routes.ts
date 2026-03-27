import { Router } from "express";
import Stripe from "stripe";
import { prisma } from "../../lib/prisma.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
export const stripeWebhookRouter = Router();

stripeWebhookRouter.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const chunks: Uint8Array[] = [];

  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    try {
      const rawBody = Buffer.concat(chunks);
      const event = stripe.webhooks.constructEvent(
        rawBody,
        sig as string,
        process.env.STRIPE_WEBHOOK_SECRET ?? ""
      );

      switch (event.type) {
        case "customer.subscription.created":
        case "customer.subscription.updated": {
          const subscription = event.data.object as Stripe.Subscription;
          const userId = subscription.metadata?.userId;
          const plan = subscription.metadata?.plan;
          if (userId && plan) {
            await prisma.user.update({
              where: { id: userId },
              data: { plan: plan as any },
            });
          }
          break;
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription;
          const userId = subscription.metadata?.userId;
          if (userId) {
            await prisma.user.update({
              where: { id: userId },
              data: { plan: "FREE" },
            });
          }
          break;
        }
      }

      res.json({ received: true });
    } catch (err: any) {
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  });
});
