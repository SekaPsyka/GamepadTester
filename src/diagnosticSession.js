import { NeutralDriftTracker, TriggerStabilityTracker } from "./gamepad.js";

function createCalibrationState() {
  return { active: false, completed: false, points: [], result: null };
}

export function gamepadSessionKey(pad) {
  return pad ? `${pad.index}:${pad.id}` : null;
}

export class DiagnosticSession {
  constructor() {
    this.controllerKey = null;
    this.revision = 0;
    this.calibration = {
      left: createCalibrationState(),
      right: createCalibrationState(),
    };
    this.neutralDrift = {
      left: new NeutralDriftTracker(),
      right: new NeutralDriftTracker(),
    };
    this.triggerStability = {
      lt: new TriggerStabilityTracker(),
      rt: new TriggerStabilityTracker(),
    };
    this.vibrationCommands = { strong: "pending", weak: "pending" };
    this.skippedGuideSteps = new Set();
    this.chatterByButton = new Map();
    this.pressCountByButton = new Map();
    this.reset();
  }

  resetCalibration(side) {
    Object.assign(this.calibration[side], createCalibrationState());
  }

  reset() {
    this.revision += 1;
    for (const side of ["left", "right"]) {
      this.resetCalibration(side);
      this.neutralDrift[side].reset();
    }
    for (const side of ["lt", "rt"]) this.triggerStability[side].reset();
    this.vibrationCommands.strong = "pending";
    this.vibrationCommands.weak = "pending";
    this.skippedGuideSteps.clear();
    this.chatterByButton.clear();
    this.pressCountByButton.clear();
    this.chatterTotal = 0;
    this.prevButtonStates = [];
    this.lastReleaseTimes = [];
    this.lastLoggedPressAt = null;
    this.mashResults = null;
    this.neutralCapture = null;
  }

  activate(pad) {
    const nextKey = gamepadSessionKey(pad);
    if (nextKey === this.controllerKey) return false;
    this.controllerKey = nextKey;
    this.reset();
    return true;
  }

  releaseController() {
    this.controllerKey = null;
    this.revision = 0;
  }
}
