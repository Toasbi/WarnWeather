import { assert, assertEquals } from "@std/assert";
import { routeRequest } from "./router.ts";

/** A router over two recording stubs. */
function recordingRoute() {
  const toNowcast: Request[] = [];
  const toKeyCheck: Request[] = [];
  const route = routeRequest(
    (req) => { toNowcast.push(req); return Promise.resolve(new Response("nowcast")); },
    (req) => { toKeyCheck.push(req); return Promise.resolve(new Response("keycheck")); },
  );
  return { route, toNowcast, toKeyCheck };
}

const ROOT = "https://edge.local/rainbow-nowcast";

Deno.test("the root: GET (legacy), POST and HEAD reach the nowcast as the same Request", async () => {
  const { route, toNowcast, toKeyCheck } = recordingRoute();
  const get = new Request(ROOT + "?lat=52.5&lon=13.4");
  const post = new Request(ROOT, { method: "POST", body: '{"lat":52.5,"lon":13.4}' });
  const head = new Request(ROOT, { method: "HEAD" });
  assertEquals(await (await route(get)).text(), "nowcast");
  assertEquals(await (await route(post)).text(), "nowcast");
  await route(head);
  assertEquals(toNowcast.length, 3);
  assert(toNowcast[0] === get && toNowcast[1] === post && toNowcast[2] === head);
  assertEquals(toKeyCheck.length, 0);
});

Deno.test("the root answers OPTIONS itself: 204, and no CORS grant to a browser page", async () => {
  const { route, toNowcast, toKeyCheck } = recordingRoute();
  const res = await route(new Request(ROOT, { method: "OPTIONS" }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("access-control-allow-origin"), null);
  assertEquals(toNowcast.length + toKeyCheck.length, 0);
});

Deno.test("'/key-check' (with or without a trailing slash, any method) reaches the key check", async () => {
  const { route, toNowcast, toKeyCheck } = recordingRoute();
  const paths = [ROOT + "/key-check", ROOT + "/key-check/", "https://edge.local/functions/v1/rainbow-nowcast/key-check"];
  for (const url of paths) {
    for (const method of ["POST", "OPTIONS", "GET"]) {
      assertEquals(await (await route(new Request(url, { method }))).text(), "keycheck", `${method} ${url}`);
    }
  }
  assertEquals(toKeyCheck.length, 9);
  assertEquals(toNowcast.length, 0);
});

Deno.test("only the LAST segment routes: a 'key-check' earlier in the path is the root", async () => {
  const { route, toNowcast, toKeyCheck } = recordingRoute();
  await route(new Request("https://edge.local/key-check/rainbow-nowcast", { method: "POST", body: "{}" }));
  assertEquals(toNowcast.length, 1);
  assertEquals(toKeyCheck.length, 0);
});

Deno.test("a throw is answered 503 (with CORS on the key-check path) and logged without its message", async () => {
  const lines: string[] = [];
  const saved = console.error;
  console.error = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try {
    const route = routeRequest(
      () => Promise.reject(new Error("lat=52.5170365 ip=203.0.113.9")),
      () => { throw new Error("key SECRETab0123456789"); },
    );
    const root = await route(new Request(ROOT, { method: "POST", body: "{}" }));
    assertEquals(root.status, 503);
    assertEquals(await root.json(), { error: "unavailable" });
    assertEquals(root.headers.get("access-control-allow-origin"), null);
    const kc = await route(new Request(ROOT + "/key-check", { method: "POST", body: "{}" }));
    assertEquals(kc.status, 503);
    assertEquals(kc.headers.get("access-control-allow-origin"), "*");
  } finally {
    console.error = saved;
  }
  assertEquals(lines, ["rainbow-nowcast unhandled", "rainbow-nowcast unhandled"]);
});
