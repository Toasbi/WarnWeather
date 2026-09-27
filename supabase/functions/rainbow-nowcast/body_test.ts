import { assert, assertEquals } from "@std/assert";
import { parseNowcastBody, parseNowcastQuery, readCapped, roundCoord } from "./body.ts";
import table from "./coord-rounding-cases.json" with { type: "json" };

Deno.test("roundCoord matches the phone's table (coord-rounding-cases.json, also run by test/coords.test.js)", () => {
  assert(table.cases.length > 10);
  for (const [input, rounded] of table.cases) {
    assert(Object.is(roundCoord(input), rounded), `${input} → ${roundCoord(input)}, want ${rounded}`);
  }
});

Deno.test("roundCoord is idempotent (the phone rounds, then the server rounds again)", () => {
  for (const [input] of table.cases) {
    assert(Object.is(roundCoord(roundCoord(input)), roundCoord(input)), String(input));
  }
  for (let k = -180000; k <= 180000; k += 997) {
    const r = roundCoord(k / 1000);
    assertEquals(roundCoord(r), r);
    assert(!String(r).includes("e"), `${r} prints without an exponent`);
    assert((String(r).split(".")[1] ?? "").length <= 3, `${r} prints at most 3 decimals`);
  }
});

Deno.test("roundCoord never returns -0 (it would print as '-0.000' in a key)", () => {
  for (const x of [-0, -0.0001, -0.0004, -0.0005]) {
    assert(Object.is(roundCoord(x), 0), String(x));
    assertEquals(roundCoord(x).toFixed(3), "0.000");
  }
});

Deno.test("parseNowcastBody: rounded numbers out, junk → null", () => {
  assertEquals(parseNowcastBody('{"lat":52.5170365,"lon":"13.3888599","start":1783339200}'),
    { lat: 52.517, lon: 13.389, start: 1783339200 });
  assertEquals(parseNowcastBody('{"lat":1,"lon":2}'), { lat: 1, lon: 2 });
  assertEquals(parseNowcastBody('{"lat":89.9996,"lon":-180}'), { lat: 90, lon: -180 });
  assertEquals(parseNowcastBody('{"lat":1,"lon":2,"start":null}')?.start, undefined);
  for (const raw of ["", "null", "[]", "1", '"x"', '{"lat":90.001,"lon":0}', '{"lat":0,"lon":180.0006}', '{"lat":false,"lon":0}']) {
    assertEquals(parseNowcastBody(raw), null, raw);
  }
});

Deno.test("parseNowcastQuery: the legacy GET, rounded the same way", () => {
  assertEquals(parseNowcastQuery(new URL("https://x/f?lat=52.5170365&lon=13.3888599&start=60")),
    { lat: 52.517, lon: 13.389, start: 60 });
  assertEquals(parseNowcastQuery(new URL("https://x/f?lat=52.5&lon=13.4&start=")),
    { lat: 52.5, lon: 13.4, start: undefined }, "an empty start is a missing one");
  assertEquals(parseNowcastQuery(new URL("https://x/f?lat=&lon=13.4")), null);
});

Deno.test("readCapped: the body up to the cap, null past it", async () => {
  const req = (body: string) => new Request("https://x/f", { method: "POST", body });
  assertEquals(await readCapped(req("abc"), 3), "abc");
  assertEquals(await readCapped(req("abcd"), 3), null);
  assertEquals(await readCapped(new Request("https://x/f"), 3), "");
});
