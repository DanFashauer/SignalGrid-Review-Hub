import React from "react";
import { signalBadge } from "@/lib/signal-tone";

export function SignalBadge({ type }: { type: string }) {
  const { tone, label } = signalBadge(type);

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${tone}`}>
      {label}
    </span>
  );
}
