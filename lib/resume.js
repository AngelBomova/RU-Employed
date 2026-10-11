import { clean, pdfToText } from "./ingest.js";
import { profile } from "./store.js";
import { failure } from "./security.js";

export async function resumeFileText(file) {
  if (!file || !/\.(pdf|txt|md)$/i.test(file.originalname))
    throw failure(400, "Choose a PDF, TXT or Markdown resume.");
  let text;
  try {
    text = /\.pdf$/i.test(file.originalname)
      ? await pdfToText(file.buffer)
      : clean(file.buffer.toString("utf8"));
  } catch {
    throw failure(
      400,
      "This resume could not be read. Try another PDF or a text file.",
    );
  }
  if (!text)
    throw failure(
      400,
      "This resume has no readable text. Try a text-based PDF or paste your resume.",
    );
  return text;
}

export async function replaceResume(req, file) {
  const resume = await resumeFileText(file);
  const materials = {
    ...(await profile(req)),
    resume,
    resumeFilename: file.originalname.split(/[\\/]/).at(-1).slice(0, 240),
  };
  await profile(req, materials);
  return materials;
}

export async function resolveResume(req, file, text) {
  if (file)
    return req.auth
      ? (await replaceResume(req, file)).resume
      : resumeFileText(file);
  const pasted = clean(text);
  if (!req.auth) return pasted;
  const saved = await profile(req);
  if (pasted && pasted !== saved.resume) {
    await profile(req, { ...saved, resume: pasted, resumeFilename: "" });
  }
  return pasted || saved.resume || "";
}
