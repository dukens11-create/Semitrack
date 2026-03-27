import Stripe from "stripe";
import { env } from "../config/env.js";

const stripe = new Stripe(env.stripeSecretKey);

function getPriceId(plan: string) {
  switch (plan) {
    case "GOLD":
      return env.stripePriceGold;
    case "DIAMOND":
      return env.stripePriceDiamond;
    case "TEAM":
      return env.stripePriceTeam;
    default:
      throw new Error("Unsupported paid plan");
  }
}

export async function createCheckoutSession(plan: "GOLD" | "DIAMOND" | "TEAM", userId: string) {
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price: getPriceId(plan),
        quantity: 1,
      },
    ],
    success_url: env.checkoutSuccessUrl,
    cancel_url: env.checkoutCancelUrl,
    client_reference_id: userId,
    metadata: {
      userId,
      plan,
    },
  });

  return {
    id: session.id,
    url: session.url,
  };
}
