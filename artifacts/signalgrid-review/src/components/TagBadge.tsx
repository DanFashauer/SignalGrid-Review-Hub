interface TagBadgeProps {
  tag: string;
}

const tagStyles: Record<string, string> = {
  "Priority 1": "bg-red-900/40 text-red-300 border-red-800/50",
  "Priority 2": "bg-amber-900/40 text-amber-300 border-amber-800/50",
  "Priority 3": "bg-stone-800/60 text-stone-400 border-stone-700/50",
  "Positioning": "bg-teal-900/40 text-teal-300 border-teal-800/50",
  "Market": "bg-sky-900/40 text-sky-300 border-sky-800/50",
  "Product": "bg-violet-900/40 text-violet-300 border-violet-800/50",
  "Engineering": "bg-indigo-900/40 text-indigo-300 border-indigo-800/50",
  "Brand": "bg-rose-900/30 text-rose-300 border-rose-800/40",
  "Go-to-Market": "bg-orange-900/40 text-orange-300 border-orange-800/50",
  "Validation": "bg-emerald-900/40 text-emerald-300 border-emerald-800/50",
  "Execution": "bg-yellow-900/40 text-yellow-300 border-yellow-800/50",
  "Operations": "bg-stone-800/60 text-stone-400 border-stone-700/50",
};

const defaultStyle = "bg-stone-800/60 text-stone-400 border-stone-700/50";

export default function TagBadge({ tag }: TagBadgeProps) {
  const style = tagStyles[tag] ?? defaultStyle;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase border ${style}`}
    >
      {tag}
    </span>
  );
}
