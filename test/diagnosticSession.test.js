import test from "node:test";
import assert from "node:assert/strict";
import { DiagnosticSession } from "../src/diagnosticSession.js";

function pad(index, id) {
  return { index, id };
}

test("conserve la session tant que la manette active ne change pas", () => {
  const session = new DiagnosticSession();
  session.activate(pad(0, "Xbox Controller"));
  session.chatterTotal = 2;

  assert.equal(session.activate(pad(0, "Xbox Controller")), false);
  assert.equal(session.chatterTotal, 2);
});
test("incrémente la révision à chaque remise à zéro", () => {
  const session = new DiagnosticSession();
  const initialRevision = session.revision;
  session.reset();
  assert.equal(session.revision, initialRevision + 1);
});

test("réinitialise toutes les mesures lors d'un changement de manette", () => {
  const session = new DiagnosticSession();
  session.activate(pad(0, "Xbox Controller"));
  session.calibration.left.completed = true;
  session.calibration.left.result = { state: "asymmetric" };
  session.chatterTotal = 3;
  session.chatterByButton.set("A", 3);
  session.pressCountByButton.set("A", 20);
  session.mashResults = [{ label: "A" }];
  session.skippedGuideSteps.add("sticks");
  session.vibrationCommands.strong = "complete";

  assert.equal(session.activate(pad(1, "Xbox Controller")), true);
  assert.equal(session.calibration.left.completed, false);
  assert.equal(session.calibration.left.result, null);
  assert.equal(session.chatterTotal, 0);
  assert.equal(session.chatterByButton.size, 0);
  assert.equal(session.pressCountByButton.size, 0);
  assert.equal(session.mashResults, null);
  assert.equal(session.skippedGuideSteps.size, 0);
  assert.equal(session.vibrationCommands.strong, "pending");
});

test("une déconnexion force une nouvelle session à la reconnexion", () => {
  const session = new DiagnosticSession();
  session.activate(pad(0, "Xbox Controller"));
  session.chatterTotal = 1;
  session.releaseController();

  assert.equal(session.activate(pad(0, "Xbox Controller")), true);
  assert.equal(session.chatterTotal, 0);
});
