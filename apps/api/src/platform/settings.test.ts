import { test } from "node:test";
import assert from "node:assert/strict";
import { envBytes, envInt, takeFallbacks } from "./settings.js";

const withEnv = (value: string | undefined, run: () => void) => {
  const before = process.env.ATEM_TEST_SETTING;
  if (value === undefined) delete process.env.ATEM_TEST_SETTING;
  else process.env.ATEM_TEST_SETTING = value;
  try {
    run();
  } finally {
    if (before === undefined) delete process.env.ATEM_TEST_SETTING;
    else process.env.ATEM_TEST_SETTING = before;
    takeFallbacks();
  }
};

test("a setting that is absent or empty takes its default, silently", () => {
  // Absent is the normal case: the default is the documented value, and there
  // is nothing to report.
  withEnv(undefined, () => {
    assert.equal(envInt("ATEM_TEST_SETTING", 10), 10);
    assert.deepEqual(takeFallbacks(), []);
  });
  withEnv("   ", () => {
    assert.equal(envInt("ATEM_TEST_SETTING", 10), 10);
    assert.deepEqual(takeFallbacks(), []);
  });
});

test("an unusable setting takes its default, and says so", () => {
  /**
   * The case that killed 0.1.0: podman-compose does not expand
   * `${ATEM_DB_POOL:-10}` and hands the container that text. `Number()` made it
   * `NaN`, the driver did `Array(NaN)`, and the API died at startup on a stack
   * trace naming nothing an operator could act on.
   */
  withEnv("${ATEM_DB_POOL:-10}", () => {
    assert.equal(envInt("ATEM_TEST_SETTING", 10), 10);
    const said = takeFallbacks();
    assert.equal(said.length, 1);
    assert.match(said[0] ?? "", /ATEM_TEST_SETTING/);
    assert.match(said[0] ?? "", /using 10/);
  });

  // The other shapes that are not a working pool size.
  for (const raw of ["0", "-4", "2.5", "abc", "1e999"]) {
    withEnv(raw, () => {
      assert.equal(envInt("ATEM_TEST_SETTING", 7), 7, raw);
      assert.equal(takeFallbacks().length, 1, raw);
    });
  }
});

test("a usable setting is taken as written", () => {
  withEnv("25", () => {
    assert.equal(envInt("ATEM_TEST_SETTING", 10), 25);
    assert.deepEqual(takeFallbacks(), []);
  });
});

test("a size in bytes accepts zero, a pool does not", () => {
  // Reserving nothing is a choice; opening no connection at all is not.
  withEnv("0", () => {
    assert.equal(envBytes("ATEM_TEST_SETTING", 200), 0);
    assert.deepEqual(takeFallbacks(), []);
    assert.equal(envInt("ATEM_TEST_SETTING", 10), 10);
    assert.equal(takeFallbacks().length, 1);
  });
});
