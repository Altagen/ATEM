import { test } from "node:test";
import assert from "node:assert/strict";
import { requireJwtSecret, resetJwtSecretCache } from "./secret.js";

/**
 * The signing key is the only thing preventing a third party from forging a
 * session. The earlier prototype had a hard-coded fallback written in three places: an
 * instance deployed without `JWT_SECRET` accepted tokens made by anyone who had
 * read the repository.
 *
 * These tests check that the safeguard refuses to start rather than warning —
 * a warning is read once and forgotten.
 */
function withSecret<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.JWT_SECRET;
  resetJwtSecretCache();
  if (value === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
    resetJwtSecretCache();
  }
}

test("a missing key prevents startup", () => {
  withSecret(undefined, () => {
    assert.throws(() => requireJwtSecret(), /JWT_SECRET is required/);
  });
});

test("a key that is too short is refused", () => {
  // Eight characters satisfy “the variable exists” while staying guessable.
  withSecret("court123", () => {
    assert.throws(() => requireJwtSecret(), /32 minimum/);
  });
});

test("the earlier prototype's old fallback is refused by name", () => {
  // It is longer than 32 characters: only an explicit comparison stops it.
  // Refusing it by name keeps it from coming back by copy-paste.
  withSecret("atem_dev_secret_key_change_me_in_prod", () => {
    assert.throws(() => requireJwtSecret(), /old fallback value/);
  });
});

test("a valid key is accepted, then cached", () => {
  const secret = "a-signing-key-of-more-than-thirty-two-characters";
  withSecret(secret, () => {
    assert.equal(requireJwtSecret(), secret);
    // The cache avoids reading the environment again on every request.
    delete process.env.JWT_SECRET;
    assert.equal(requireJwtSecret(), secret);
  });
});
