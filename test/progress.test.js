import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeProgress } from "../public/analytics.js";
import { reportMetrics } from "../lib/progress.js";

const now = Date.UTC(2026, 9, 10);
const report = (days, score, fields = {}) => ({
  id: String(days),
  createdAt: new Date(now - days * 86400000).toISOString(),
  rubricVersion: "ru-v2",
  focus: "behavioral",
  durationSeconds: 1800,
  metrics: { overall: score, communication: score, clarity: null },
  ...fields,
});
test("progress excludes demos, filters time and focus, preserves unassessed categories and compares only matching rubrics/types", () => {
  const reports = [
    report(100, 20),
    report(20, 50),
    report(4, 70, { focus: "technical" }),
    report(3, 90, { demo: true }),
    report(2, 65, { rubricVersion: "legacy" }),
    report(1, 80),
  ];
  const data = analyzeProgress(reports, { now, days: 30, focus: "behavioral" });
  assert.equal(data.total, 3);
  assert.equal(data.average, 65);
  assert.equal(data.highest, 80);
  assert.equal(data.hours, 1.5);
  assert.equal(data.previous.metrics.overall, 50);
  assert.equal(data.changes[0].delta, 30);
  assert.ok(!data.changes.some((c) => c.key === "clarity"));
  assert.equal(
    analyzeProgress(reports, { now, days: 7, focus: "technical" }).total,
    1,
  );
  assert.equal(
    analyzeProgress(reports, { now, days: 7, focus: "coding" }).total,
    0,
  );
  assert.equal(analyzeProgress([], { now }).average, null);
});
test("typed answers do not invent vocal pace or confidence; filler frequency is normalized by word count", () => {
  const r = {
    demo: false,
    transcript: [
      {
        role: "candidate",
        metrics: { source: "typed", word_count: 50, filler_total: 2 },
      },
    ],
    feedback: {
      overall: { score: 70 },
      category_scores: { technical: null, structure: 80 },
      answers: [],
      delivery: { confidence_score: 90 },
    },
  };
  const metrics = reportMetrics(r);
  assert.equal(metrics.pace, null);
  assert.equal(metrics.confidence, null);
  assert.equal(metrics.technical, null);
  assert.equal(metrics.fillers_per_100, 4);
  r.transcript[0].metrics = {
    source: "voice",
    word_count: 50,
    filler_total: 2,
    words_per_minute: 140,
  };
  assert.equal(reportMetrics(r).pace, 140);
  assert.equal(reportMetrics(r).confidence, 90);
});
