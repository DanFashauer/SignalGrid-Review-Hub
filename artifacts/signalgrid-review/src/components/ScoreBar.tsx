interface ScoreBarProps {
  score: number;
  maxScore: number;
  status: "strong" | "developing" | "gap";
  size?: "sm" | "md" | "lg";
  animated?: boolean;
}

const statusColors = {
  strong: "bg-teal-600",
  developing: "bg-amber-700",
  gap: "bg-red-800",
};

const statusTrack = {
  strong: "bg-teal-950",
  developing: "bg-amber-950",
  gap: "bg-red-950",
};

export default function ScoreBar({
  score,
  maxScore,
  status,
  size = "md",
  animated = true,
}: ScoreBarProps) {
  const pct = Math.round((score / maxScore) * 100);
  const heights = { sm: "h-1", md: "h-1.5", lg: "h-2" };

  return (
    <div className={`w-full rounded-full overflow-hidden ${statusTrack[status]} ${heights[size]}`}>
      <div
        className={`${heights[size]} rounded-full ${statusColors[status]} transition-all duration-1000 ease-out`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
