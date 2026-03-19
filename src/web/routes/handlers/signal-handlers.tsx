/**
 * Signal handlers — view and dismiss engagement signals.
 */

import type { IntentHandler } from "../chat-handlers.tsx";
import { SignalsFeedCard } from "../../cards/signals-feed.tsx";
import { getActiveSignals } from "../../../services/signals-service.ts";

export const handleSignals: IntentHandler = async () => {
  const signals = await getActiveSignals();
  return {
    html: <SignalsFeedCard signals={signals} />,
    summary: `${signals.length} active signals`,
  };
};
