export const RUBRIC_VERSION = "ru-v2";
export const RUBRIC =
  "Score 0-100: 0-20 no evidence, 21-40 fragmentary, 41-60 adequate but gaps, 61-80 specific and mostly complete, 81-100 precise, justified, and complete. Communication: direct answers and clear ownership. Clarity: concise wording and relevance. Structure: coherent setup, reasoning/actions, outcome. Behavioral: concrete experience and reflection. Technical: accurate reasoning and tradeoffs; null if not assessed. Never score an unassessed category.";
export function reportMetrics(report) {
  const answers = report.transcript.filter((t) => t.role === "candidate");
  const voiced = answers.filter(
    (t) =>
      t.metrics?.source === "voice" &&
      Number.isFinite(t.metrics.words_per_minute),
  );
  const words = answers.reduce((n, t) => n + (t.metrics?.word_count || 0), 0);
  const fillers = answers.reduce(
    (n, t) => n + (t.metrics?.filler_total || 0),
    0,
  );
  const stars = report.feedback.answers.flatMap((a) =>
    Object.values(a.star || {}).map((s) => s.score),
  );
  return {
    overall: report.feedback.overall.score,
    ...(report.feedback.category_scores || {}),
    structure: report.feedback.category_scores
      ? (report.feedback.category_scores.structure ?? null)
      : stars.length
        ? Math.round((stars.reduce((a, b) => a + b, 0) / stars.length) * 20)
        : null,
    confidence:
      !report.demo && voiced.length
        ? report.feedback.delivery.confidence_score
        : null,
    pace: voiced.length
      ? Math.round(
          voiced.reduce((n, t) => n + t.metrics.words_per_minute, 0) /
            voiced.length,
        )
      : null,
    fillers_per_100: words ? Math.round((fillers / words) * 1000) / 10 : null,
  };
}
export function buildReport(session) {
  const report = {
    id: session.id,
    sessionId: session.id,
    demo: session.demo,
    createdAt: new Date(session.startedAt).toISOString(),
    completedAt: new Date().toISOString(),
    durationSeconds: Math.max(
      0,
      Math.round((Date.now() - session.startedAt) / 1000),
    ),
    focus: session.focus || "mixed",
    rubricVersion: RUBRIC_VERSION,
    camera: session.camera || null,
    feedback: session.feedback,
    transcript: session.turns,
    plan: {
      company: session.plan.company,
      role: session.plan.role,
      interviewer: session.plan.interviewer,
    },
  };
  report.metrics = reportMetrics(report);
  return report;
}
