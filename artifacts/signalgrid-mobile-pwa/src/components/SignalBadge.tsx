import React from "react";
import { SignalType } from "@workspace/api-client-react";

export function SignalBadge({ type }: { type: string }) {
  let colors = "text-zinc-400 bg-zinc-400/10 border-zinc-400/20";
  
  if (type === SignalType.identity) {
    colors = "text-blue-400 bg-blue-400/10 border-blue-400/20";
  } else if (type === SignalType["device-posture"]) {
    colors = "text-indigo-400 bg-indigo-400/10 border-indigo-400/20";
  } else if (type === SignalType["session-context"]) {
    colors = "text-purple-400 bg-purple-400/10 border-purple-400/20";
  } else if (type === SignalType["operational-signals"]) {
    colors = "text-pink-400 bg-pink-400/10 border-pink-400/20";
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${colors}`}>
      {type.replace("-", " ")}
    </span>
  );
}
