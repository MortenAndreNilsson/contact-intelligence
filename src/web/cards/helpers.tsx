export function relativeDate(dateStr: string): string {
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "—";
  const diff = Date.now() - then;
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function sectionBadge(section: string | null) {
  if (!section) return null;
  const cls = section === "learn" ? "badge-lime" : section === "blog" ? "badge-turquoise" : "badge-green";
  return <span class={`badge ${cls}`}>{section}</span>;
}
