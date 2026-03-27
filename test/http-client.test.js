const test = require("node:test");
const assert = require("node:assert/strict");

const { requestJson } = require("../adapters/http-client");

test("requestJson falls back to curl when fetch hits a DNS failure", async () => {
  let curlCalled = false;

  const result = await requestJson("https://example.com/data", {
    source: {
      id: "vps_history",
      name: "VPS history",
      critical: true,
    },
    fetchImpl: async () => {
      const error = new TypeError("fetch failed");
      error.cause = { code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND example.com" };
      throw error;
    },
    curlImpl: async () => {
      curlCalled = true;
      return {
        data: { ok: true },
        meta: {
          transport: "curl",
          fallbackUsed: true,
          sourceStatus: {
            id: "vps_history",
            name: "VPS history",
            critical: true,
            status: "degraded",
            message: "Live request succeeded through curl fallback",
            updatedAt: new Date().toISOString(),
          },
        },
      };
    },
  });

  assert.equal(curlCalled, true);
  assert.equal(result.data.ok, true);
  assert.equal(result.meta.transport, "curl");
  assert.equal(result.meta.sourceStatus.status, "degraded");
});

test("requestJson returns a down source status when fetch and fallback both fail", async () => {
  await assert.rejects(
    () => requestJson("https://example.com/data", {
      source: {
        id: "vps_history",
        name: "VPS history",
        critical: true,
      },
      fetchImpl: async () => {
        const error = new TypeError("fetch failed");
        error.cause = { code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND example.com" };
        throw error;
      },
      curlImpl: async () => {
        throw new Error("curl: (6) Could not resolve host: example.com");
      },
    }),
    (error) => {
      assert.equal(error.sourceStatus.status, "down");
      assert.equal(error.sourceStatus.id, "vps_history");
      return true;
    }
  );
});
