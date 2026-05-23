import React from "react";

export function StatusDot({ status }: { status: string }) {
  let color = "bg-zinc-500";
  let pulse = false;

  switch (status) {
    case "connected":
    case "nominal":
      color = "bg-green-400";
      break;
    case "degraded":
    case "anomalous":
      color = "bg-amber-400";
      pulse = true;
      break;
    case "critical":
    case "disconnected":
      color = "bg-red-400";
      pulse = true;
      break;
    case "not-configured":
    case "unknown":
    default:
      color = "bg-zinc-500";
      break;
  }

  return (
    <span className="relative flex h-2.5 w-2.5">
      {pulse && (
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${color}`} />
      )}
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
    </span>
  );
}
