import test from "node:test";
import assert from "node:assert/strict";
import { MashSequenceTest, buildMashQueue, buildMashVerdict, gradeForChatter } from "../src/mashTest.js";

test("exclut les boutons système Guide et PS du diagnostic répété", () => {
  const xboxQueue = buildMashQueue(["A", "B", "Guide"], 3);
  const playstationQueue = buildMashQueue(["✕", "PS", "Pavé tactile"], 3);
  const genericQueue = buildMashQueue(["B0", "B1", "B16"], 3);

  assert.deepEqual(xboxQueue.map(({ label }) => label), ["A", "B"]);
  assert.deepEqual(playstationQueue.map(({ label }) => label), ["✕", "Pavé tactile"]);
  assert.deepEqual(genericQueue.map(({ label }) => label), ["B0", "B1", "B16"]);
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
