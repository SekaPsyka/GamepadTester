import test from "node:test";
import assert from "node:assert/strict";
import { MashSequenceTest, buildMashQueue, buildMashVerdict, gradeForChatter } from "../src/mashTest.js";

test("exclut les gâchettes analogiques et les boutons système du diagnostic répété", () => {
  const xboxQueue = buildMashQueue(["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "Guide"], 11);
  const playstationQueue = buildMashQueue(["✕", "○", "□", "△", "L1", "R1", "L2", "R2", "Share", "Options", "PS", "Pavé tactile"], 12);
  const genericQueue = buildMashQueue(Array.from({ length: 17 }, (_, index) => `B${index}`), 17);

  assert.deepEqual(xboxQueue.map(({ label }) => label), ["A", "B", "X", "Y", "LB", "RB", "View", "Menu"]);
  assert.deepEqual(playstationQueue.map(({ label }) => label), ["✕", "○", "□", "△", "L1", "R1", "Share", "Options", "Pavé tactile"]);
  assert.deepEqual(genericQueue.map(({ label }) => label), ["B0", "B1", "B2", "B3", "B4", "B5", "B8", "B9", "B10", "B11", "B12", "B13", "B14", "B15", "B16"]);
});

test("ne rend pas de note avec moins de vingt appuis", () => {
  assert.equal(gradeForChatter(0, 19).key, "na");
  assert.equal(gradeForChatter(0, 20).key, "excellent");
});

test("compte une série régulière sans faux double déclenchement", () => {
  const sequence = new MashSequenceTest([{ index: 0, label: "A" }], 5000);
  let now = 1;
  for (let press = 0; press < 20; press++) {
    sequence.feed([{ pressed: true, value: 1 }], now, 20, now);
    now += 100;
    sequence.feed([{ pressed: false, value: 0 }], now, 20, now);
    now += 100;
  }
  sequence.feed([{ pressed: false, value: 0 }], 5002, 20, 5002);
  assert.equal(sequence.finished, true);
  assert.equal(sequence.results[0].pressCount, 20);
  assert.equal(sequence.results[0].chatterCount, 0);
  assert.equal(sequence.results[0].reliable, true);
});

test("signale un double déclenchement rapproché", () => {
  const sequence = new MashSequenceTest([{ index: 0, label: "A" }], 1000);
  sequence.feed([{ pressed: true, value: 1 }], 1, 16, 1);
  sequence.feed([{ pressed: false, value: 0 }], 100, 16, 100);
  sequence.feed([{ pressed: true, value: 1 }], 140, 16, 140);
  sequence.feed([{ pressed: false, value: 0 }], 1002, 16, 1002);
  assert.equal(sequence.results[0].chatterCount, 1);
});

test("le verdict reste prudent quand aucune donnée n'est exploitable", () => {
  assert.equal(buildMashVerdict([]).tone, "neutral");
});
