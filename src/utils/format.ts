export function formatNumber(value: number | null | undefined, digits = 4, fallback = "-"): string {
  if (value == null || Number.isNaN(value)) return fallback;
  return Number(value).toFixed(digits);
}

export function formatPrice(value: number | string | null | undefined, digits = 4, fallback = "-"): string {
  if (value == null) return fallback;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return fallback;
  return Number(n).toFixed(digits);
}

export function formatTrendLabel(trend: "做多" | "做空" | "无信号"): string {
  switch (trend) {
    case "做多":
      return "롱";
    case "做空":
      return "숏";
    case "无信号":
    default:
      return "신호 없음";
  }
}
