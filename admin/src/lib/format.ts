export function formatMoney(value: string | number): string {
  const n = typeof value === "string" ? Number(value) : value;
  return `₹${n.toFixed(2)}`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatDateTime(iso);
}

export function statusBadgeClass(status: string): string {
  return `badge badge-${status.toLowerCase()}`;
}
