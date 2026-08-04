import crypto from 'crypto';

/**
 * Password generation and strength, in one place.
 *
 * Every path that sets a password — enrolment, admin reset, a user choosing
 * their own — goes through here, so the rules cannot drift between them.
 */

/** Long enough to resist offline guessing; no composition rules. */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * Rejected outright. Deliberately short: this is not a breach corpus, it is the
 * handful anyone reaches for first, plus the ones this project shipped with.
 */
const OBVIOUS = new Set([
  'password', 'password1', 'password123', 'passw0rd',
  '1234567890', '12345678901', 'qwertyuiop', 'qwerty123',
  'letmein123', 'welcome123', 'admin12345', 'administrator',
  'shiftly123', 'shiftly1234', 'admin123456', 'iloveyou123',
]);

/**
 * Unambiguous alphabet: no O/0, I/l/1. A temporary password is read off a screen
 * and typed by someone else, and `Il0O` is where that goes wrong.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/**
 * A one-time password, grouped for reading aloud — `k7Rq-nP4t-Vb2x`.
 *
 * 12 characters from a 56-symbol alphabet is ~70 bits, which is far beyond what
 * a credential living for one login needs, and costs nothing.
 *
 * `crypto.randomInt` rather than `Math.random`: the latter is not seeded for
 * unpredictability and must never generate a credential.
 */
export function generateTemporaryPassword() {
  const chars = Array.from({ length: 12 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8)].map((g) => g.join('')).join('-');
}

/**
 * Returns an error string, or null when the password is acceptable.
 *
 * `email` is used to reject a password built from the address it signs in with,
 * which is the most common weak choice this catches in practice.
 */
export function passwordProblem(password, email) {
  if (typeof password !== 'string' || password.length === 0) {
    return 'A password is required';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }

  const lower = password.toLowerCase();
  if (OBVIOUS.has(lower)) {
    return 'That password is too easy to guess — pick something else';
  }

  const localPart = String(email || '').split('@')[0].toLowerCase();
  if (localPart.length >= 3 && lower.includes(localPart)) {
    return 'Password must not contain your email address';
  }

  return null;
}
