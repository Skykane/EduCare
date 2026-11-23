const bcrypt = require('bcryptjs');

// EduCare password policy. Keep this in sync with the registration checklist in
// views/register.ejs.
const SPECIAL_CHARACTERS = '!@#$%^&*';
const SPECIAL_RE = /[!@#$%^&*]/;

/**
 * Validates a password against EduCare security policy:
 * - Minimum 8 characters
 * - At least one uppercase letter (A-Z)
 * - At least one lowercase letter (a-z)
 * - At least one number (0-9)
 * - At least one special character (!@#$%^&*)
 * - Passwords match confirm
 * - Cannot be identical to current password
 */
function validatePassword(password, options = {}) {
  const { passwordHash, confirm } = options;
  const errors = [];
  const checks = {
    length: false,
    hasLetters: false,
    hasUpper: false,
    hasLower: false,
    hasNumber: false,
    hasSpecial: false,
    // Kept for older callers that read the combined strength flags.
    hasNumbersOrSymbols: false,
    match: true,
    notCurrent: true,
  };

  const str = String(password || '');

  // 1. Length (minimum 8 characters)
  checks.length = str.length >= 8;
  if (!checks.length) {
    errors.push('Password must be at least 8 characters long.');
  }

  // 2. Letter case (both are required)
  checks.hasUpper = /[A-Z]/.test(str);
  checks.hasLower = /[a-z]/.test(str);
  checks.hasLetters = checks.hasUpper || checks.hasLower;
  if (!checks.hasUpper) {
    errors.push('Password must contain at least one uppercase letter (A-Z).');
  }
  if (!checks.hasLower) {
    errors.push('Password must contain at least one lowercase letter (a-z).');
  }

  // 3. Number and allowed symbol
  checks.hasNumber = /[0-9]/.test(str);
  checks.hasSpecial = SPECIAL_RE.test(str);
  checks.hasNumbersOrSymbols = checks.hasNumber || checks.hasSpecial;
  if (!checks.hasNumber) {
    errors.push('Password must contain at least one number (0-9).');
  }
  if (!checks.hasSpecial) {
    errors.push(`Password must contain at least one special character (${SPECIAL_CHARACTERS}).`);
  }

  // 4. Confirm match
  if (confirm !== undefined) {
    checks.match = str === String(confirm || '');
    if (!checks.match) {
      errors.push('Passwords do not match. Please verify your confirm password.');
    }
  }

  // 5. Cannot be identical to current password
  if (passwordHash && str) {
    try {
      const isSame = bcrypt.compareSync(str, passwordHash);
      checks.notCurrent = !isSame;
      if (isSame) {
        errors.push('New password cannot be the same as your current password.');
      }
    } catch {
      // Ignore bcrypt compare error
    }
  }

  // Strength score: 1 to 5
  let score = 0;
  if (checks.length) score++;
  if (checks.hasUpper && checks.hasLower) score++;
  if (checks.hasNumber) score++;
  if (checks.hasSpecial) score++;
  if (str.length >= 12 && score >= 3) score++;

  return {
    valid: errors.length === 0,
    errors,
    checks,
    score: Math.min(5, Math.max(1, score)),
  };
}

module.exports = { validatePassword, PASSWORD_RULES: { specialCharacters: SPECIAL_CHARACTERS } };
