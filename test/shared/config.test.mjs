import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRuntimeConfig,
  resolveSecret,
  resolveChromiumExecutablePath,
} from "../../src/shared/config.mjs";

test("resolveSecret: returns raw value on non-PASS input", () => {
  assert.equal(resolveSecret("plain-value", { platform: "linux" }), "plain-value");
  assert.equal(resolveSecret("", { platform: "linux" }), "");
});

test("resolveSecret: resolves PASS value when secret command succeeds", () => {
  const out = resolveSecret("PASS:cafe/user", {
    platform: "linux",
    exec() {
      return Buffer.from("secret-from-pass\n");
    }
  });
  assert.equal(out, "secret-from-pass");
});

test("resolveSecret: returns raw PASS value and warns when command fails", () => {
  const warnings = [];
  const out = resolveSecret("PASS:cafe/missing", {
    platform: "linux",
    exec() {
      throw new Error("forced failure");
    },
    warn(message) {
      warnings.push(String(message));
    }
  });

  assert.equal(out, "PASS:cafe/missing");
  assert.ok(warnings.some(msg => msg.includes("Falha ao resolver")));
});

test("resolveSecret: bypasses PASS command on win32", () => {
  const out = resolveSecret("PASS:any/path", {
    platform: "win32",
    exec() {
      throw new Error("should not execute");
    }
  });

  assert.equal(out, "PASS:any/path");
});

test("resolveChromiumExecutablePath: prefers explicit env and known system chromium", () => {
  assert.equal(
    resolveChromiumExecutablePath({ CHROMIUM_EXECUTABLE_PATH: "/tmp/chromium" }, {
      platform: "linux",
      exists() {
        return false;
      },
      exec() {
        throw new Error("should not be called");
      },
    }),
    "/tmp/chromium"
  );

  const detected = resolveChromiumExecutablePath({}, {
    platform: "linux",
    exists(candidate) {
      return candidate === "/usr/bin/chromium";
    },
    exec() {
      throw new Error("should not be called when common path exists");
    },
  });

  assert.equal(detected, "/usr/bin/chromium");
});

test("buildRuntimeConfig: detectLang fallback when detector is disabled", async () => {
  const runtime = buildRuntimeConfig({
    env: {
      DETECTLANGUAGE_API_KEY: "",
      CAFE_USERNAME: "",
      CAFE_PASSWORD: "",
      CHROMIUM_EXECUTABLE_PATH: "",
      CAFE_AUTO_CLICK_LOGIN: "",
    },
    exists(candidate) {
      return candidate === "/usr/bin/chromium";
    },
  });

  assert.equal(await runtime.detectLang("qualquer"), "en");
  assert.equal(await runtime.translateIfNeeded("already-en"), "already-en");
  assert.equal(runtime.SETTINGS.cafeUsername, "mock_username");
  assert.equal(runtime.SETTINGS.cafePassword, "mock_password");
  assert.equal(runtime.SETTINGS.executablePath, "/usr/bin/chromium");
  assert.equal(runtime.SETTINGS.cafeAutoClickLogin, false);
});

test("buildRuntimeConfig: detectLang success and translate success", async () => {
  class FakeDetector {
    async detect() {
      return [{ language: "pt" }];
    }
  }

  const runtime = buildRuntimeConfig({
    env: {
      DETECTLANGUAGE_API_KEY: "fake-key",
      CAFE_USERNAME: "user",
      CAFE_PASSWORD: "pass",
      CAFE_AUTO_CLICK_LOGIN: "true",
      CHROMIUM_EXECUTABLE_PATH: "/tmp/chromium",
    },
    DetectLanguageCtor: FakeDetector,
    exists(candidate) {
      return candidate === "/tmp/chromium";
    },
    translateModule: {
      async default(text, options) {
        assert.equal(options.from, "pt");
        assert.equal(options.to, "en");
        return { text: `translated:${text}` };
      }
    }
  });

  assert.equal(await runtime.detectLang("ola"), "pt");
  assert.equal(await runtime.translateIfNeeded("ola mundo"), "translated:ola mundo");
  assert.equal(runtime.SETTINGS.cafeAutoClickLogin, true);
  assert.equal(runtime.SETTINGS.executablePath, "/tmp/chromium");
});

test("buildRuntimeConfig: detectLang catch + translateIfNeeded catch + un short-circuit", async () => {
  class FailingDetector {
    async detect() {
      throw new Error("forced detect error");
    }
  }

  const runtimeWithFailingDetector = buildRuntimeConfig({
    env: { DETECTLANGUAGE_API_KEY: "fake-key" },
    DetectLanguageCtor: FailingDetector,
    exists() {
      return false;
    },
  });
  assert.equal(await runtimeWithFailingDetector.detectLang("texto"), "en");

  class PortugueseDetector {
    async detect() {
      return [{ language: "pt" }];
    }
  }
  const runtimeWithTranslateError = buildRuntimeConfig({
    env: { DETECTLANGUAGE_API_KEY: "fake-key" },
    DetectLanguageCtor: PortugueseDetector,
    exists() {
      return false;
    },
    translateModule: {
      async default() {
        throw new Error("forced translate error");
      }
    }
  });
  assert.equal(await runtimeWithTranslateError.translateIfNeeded("texto"), "texto");

  class UnknownDetector {
    async detect() {
      return [{ language: "un" }];
    }
  }
  const runtimeWithUn = buildRuntimeConfig({
    env: { DETECTLANGUAGE_API_KEY: "fake-key" },
    DetectLanguageCtor: UnknownDetector,
    exists() {
      return false;
    },
  });
  assert.equal(await runtimeWithUn.translateIfNeeded("texto bruto"), "texto bruto");
});
