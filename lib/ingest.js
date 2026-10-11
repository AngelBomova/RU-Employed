// Turns the candidate's uploads (resume PDF, LinkedIn PDF export, job posting URL)
// into plain text the interviewer can work from.
import { createRequire } from "node:module";
import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";

const require = createRequire(import.meta.url);
// Import the inner module: pdf-parse's index.js runs a debug harness when it has no parent module.
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

const MAX_CHARS = 60_000;

export async function pdfToText(buffer) {
  const { text } = await pdfParse(buffer);
  return clean(text);
}

export function clean(text = "") {
  return String(text)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_CHARS);
}

export function htmlToText(html) {
  return clean(
    html
      .replace(
        /<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi,
        " ",
      )
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))),
  );
}

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = ip.toLowerCase();
  // Accept only global-unicast IPv6. This also rejects mapped IPv4 and local ranges.
  const prefix = parseInt(v6.split(":")[0], 16);
  return (
    !net.isIPv6(ip) ||
    !(prefix >= 0x2000 && prefix <= 0x3fff) ||
    v6.startsWith("2001:db8:")
  );
}

const pageError = (message) =>
  Object.assign(new Error(message), { status: 400 });
async function publicPage(url, signal) {
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw pageError(
      "Use a public http(s) page without credentials in the URL.",
    );
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(hostname)
    ? [{ address: hostname, family: net.isIP(hostname) }]
    : await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address)))
    throw pageError(
      "That link must point to a public website. Paste the text instead.",
    );
  const selected = addresses[0];
  // Pin the validated address to the actual connection, preventing DNS rebinding.
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).get(
      url,
      {
        agent: false,
        signal,
        lookup: (_name, options, callback) =>
          options.all
            ? callback(null, [selected])
            : callback(null, selected.address, selected.family),
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; RUEmployed/1.0)",
          accept: "text/html,text/plain",
          "accept-encoding": "identity",
        },
      },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          resolve({ redirect: response.headers.location });
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          reject(
            pageError(
              `Couldn't load that page (HTTP ${response.statusCode}). Paste the text instead.`,
            ),
          );
          return;
        }
        if (
          !/^(text\/|application\/xhtml\+xml)/i.test(
            response.headers["content-type"] || "",
          )
        ) {
          response.resume();
          reject(
            pageError(
              "That link is not a readable text page. Paste its text instead.",
            ),
          );
          return;
        }
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024)
            response.destroy(
              pageError(
                "That page is too large. Paste the job or portfolio details instead.",
              ),
            );
          else chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            html: /html/i.test(response.headers["content-type"]),
          }),
        );
        response.on("error", reject);
      },
    );
    request.on("error", reject);
  });
}

// Fetches a public job-posting page and strips it to text.
export async function fetchJobPosting(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw pageError("That job description link isn't a valid URL.");
  }
  const signal = AbortSignal.timeout(15_000);
  for (let hops = 0; hops < 4; hops++) {
    const page = await publicPage(url, signal);
    if (page.redirect !== undefined) {
      if (!page.redirect)
        throw pageError(
          "That page returned an invalid redirect. Paste the text instead.",
        );
      url = new URL(page.redirect, url);
      continue;
    }
    const text = page.html ? htmlToText(page.body) : clean(page.body);
    if (text.length < 200)
      throw pageError(
        "That page didn't have readable details (it may need JavaScript or a login). Paste the text instead.",
      );
    return text;
  }
  throw pageError(
    "That page redirects too many times. Paste the text instead.",
  );
}
