export const CATEGORY_LABELS = {
  overall: "Overall score",
  communication: "Communication",
  technical: "Technical knowledge",
  behavioral: "Behavioral performance",
  clarity: "Answer clarity",
  structure: "Response structure",
  confidence: "Confidence (inferred)",
  pace: "Speaking pace (WPM)",
  fillers_per_100: "Fillers per 100 words",
};
export function metricsFor(report) {
  if (report.metrics) return report.metrics;
  const spoken =
    report.transcript?.filter(
      (t) => t.role === "candidate" && t.metrics?.source === "voice",
    ) || [];
  const all = report.transcript?.filter((t) => t.role === "candidate") || [];
  const words = all.reduce((n, t) => n + (t.metrics?.word_count || 0), 0);
  const fillers = all.reduce((n, t) => n + (t.metrics?.filler_total || 0), 0);
  return {
    overall: report.feedback.overall.score,
    ...(report.feedback.category_scores || {}),
    confidence: null,
    pace: spoken.length
      ? spoken.reduce((n, t) => n + (t.metrics.words_per_minute || 0), 0) /
        spoken.length
      : null,
    fillers_per_100: words ? (fillers / words) * 100 : null,
  };
}
export function analyzeProgress(
  reports,
  { days = 0, focus = "all", now = Date.now() } = {},
) {
  const filtered = reports
    .filter(
      (r) =>
        !r.demo &&
        (!days || Date.parse(r.createdAt) >= now - days * 86400000) &&
        (focus === "all" ||
          (focus === "coding"
            ? r.kind === "coding"
            : r.kind !== "coding" && r.focus === focus)),
    )
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const scores = filtered
    .map((r) => metricsFor(r).overall)
    .filter(Number.isFinite);
  const latest = filtered.at(-1);
  const comparable = latest
    ? filtered.filter(
        (r) =>
          r.rubricVersion === latest.rubricVersion &&
          (r.focus || "mixed") === (latest.focus || "mixed") &&
          r.kind === latest.kind,
      )
    : [];
  const previous = comparable.at(-2);
  const first = comparable[0];
  const changes =
    first && comparable.length > 1
      ? Object.keys(CATEGORY_LABELS)
          .filter((k) => !["pace", "fillers_per_100", "overall"].includes(k))
          .map((key) => ({
            key,
            delta:
              Number.isFinite(metricsFor(latest)[key]) &&
              Number.isFinite(metricsFor(first)[key])
                ? metricsFor(latest)[key] - metricsFor(first)[key]
                : null,
          }))
          .filter((x) => x.delta !== null)
          .sort((a, b) => b.delta - a.delta)
      : [];
  return {
    filtered,
    latest,
    previous,
    changes,
    total: filtered.length,
    average: scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null,
    highest: scores.length ? Math.max(...scores) : null,
    hours: filtered.reduce((n, r) => n + (r.durationSeconds || 0), 0) / 3600,
  };
}
