"use strict";

/**
 * Next.js adapters import `server-only` so they cannot be bundled into the
 * browser. The worker is a Node process, so that package must be a no-op here.
 * Never print environment values from this file.
 */
const Module = require("module");

const originalLoad = Module._load;
Module._load = function loadStubbedServerOnly(request, parent, isMain) {
  if (request === "server-only") {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};
