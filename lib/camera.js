// Accept only bounded aggregates. Never retain frames or classify emotion/personality.
export function cameraSummary(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !Number.isInteger(value.samples) ||
    value.samples < 1 ||
    value.samples > 30000
  )
    return null;
  const fraction = (x) =>
    typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1
      ? Math.round(x * 1000) / 1000
      : null;
  if (fraction(value.faceVisible) === null) return null;
  return {
    samples: value.samples,
    seconds: Math.min(12000, Math.round(value.samples * 0.4)),
    faceVisible: fraction(value.faceVisible),
    cameraFacing: fraction(value.cameraFacing),
    framing: fraction(value.framing),
    facialMovement: fraction(value.facialMovement),
    sufficient: value.samples >= 25 && value.samples * value.faceVisible >= 15,
    source:
      "Local landmark estimates; not a measure of eye contact, emotion, or confidence.",
  };
}
