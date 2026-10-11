import { test, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import dns from "node:dns/promises";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { fetchJobPosting, isPrivateAddress } from "../lib/ingest.js";

test("job and portfolio links reject local addresses including IPv6 and redirects to private services", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "::1",
    "::ffff:7f00:1",
    "fe80::1",
    "fc00::1",
  ])
    assert.equal(isPrivateAddress(ip), true, ip);
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  assert.equal(isPrivateAddress("2606:4700:4700::1111"), false);
  await assert.rejects(
    fetchJobPosting("http://127.0.0.1/admin"),
    /public website/,
  );
  await assert.rejects(fetchJobPosting("file:///etc/passwd"), /public http/);
  const lookup = mock.method(dns, "lookup", async () => [
    { address: "8.8.8.8", family: 4 },
  ]);
  const get = mock.method(http, "get", (_url, options, callback) => {
    options.lookup("jobs.test", { all: true }, (error, addresses) => {
      assert.equal(error, null);
      assert.equal(addresses[0].address, "8.8.8.8");
    });
    const request = new EventEmitter();
    queueMicrotask(() => {
      const response = Readable.from([]);
      response.statusCode = 302;
      response.headers = { location: "http://169.254.169.254/metadata" };
      callback(response);
    });
    return request;
  });
  try {
    await assert.rejects(
      fetchJobPosting("http://jobs.test/posting"),
      /public website/,
    );
    assert.equal(
      get.mock.callCount(),
      1,
      "The redirected private service must never receive a request",
    );
  } finally {
    lookup.mock.restore();
    get.mock.restore();
  }
});
test("page ingestion pins a public address and limits response size before extracting text", async () => {
  const lookup = mock.method(dns, "lookup", async () => [
    { address: "8.8.8.8", family: 4 },
  ]);
  let large = false;
  const get = mock.method(http, "get", (_url, options, callback) => {
    const request = new EventEmitter();
    queueMicrotask(() => {
      const response = Readable.from([
        Buffer.from(
          large
            ? "x".repeat(2 * 1024 * 1024 + 1)
            : "<h1>Software Engineer</h1><p>" +
                "Build and test reliable systems. ".repeat(20) +
                "</p>",
        ),
      ]);
      response.statusCode = 200;
      response.headers = { "content-type": "text/html" };
      callback(response);
    });
    return request;
  });
  try {
    assert.match(
      await fetchJobPosting("http://jobs.test/posting"),
      /Software Engineer/,
    );
    large = true;
    await assert.rejects(
      fetchJobPosting("http://jobs.test/large"),
      /too large/,
    );
  } finally {
    lookup.mock.restore();
    get.mock.restore();
  }
});
