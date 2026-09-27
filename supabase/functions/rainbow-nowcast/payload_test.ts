import { assertEquals } from "@std/assert";
import { pickForecast } from "./payload.ts";

Deno.test("pickForecast keeps the forecast intervals and drops the echoed position and summary", () => {
  const interval = { precipRate: 1.2, precipType: "rain", timestampBegin: 60, timestampEnd: 360 };
  assertEquals(
    pickForecast({ latitude: 52.517, longitude: 13.389, summary: { intensity: "rain" }, forecast: [interval] }),
    { forecast: [interval] },
  );
});

Deno.test("pickForecast drops unknown interval fields and non-object entries", () => {
  assertEquals(
    pickForecast({ forecast: [{ precipRate: 1, timestampBegin: 1, timestampEnd: 2, lat: 52.5 }, null, 3, [1]] }),
    { forecast: [{ precipRate: 1, timestampBegin: 1, timestampEnd: 2 }] },
  );
});

Deno.test("pickForecast: a missing or malformed forecast is [] (the phone's out-of-coverage clear)", () => {
  for (const p of [null, undefined, 1, "x", [], {}, { forecast: null }, { forecast: {} }]) {
    assertEquals(pickForecast(p), { forecast: [] }, JSON.stringify(p));
  }
});
