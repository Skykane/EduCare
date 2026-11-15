const bcrypt = require('bcryptjs');

/**
 * Validates a password against EduCare security policy:
 * - Minimum 8 characters
 * - Must contain letters (A-Z or a-z)
 * - Must contain numbers (0-9) or special characters (!@#$%)
 * - Passwords match confirm
 * - Cannot be identical to current password
 */
function validatePassword(password, options = {}) {
  const { passwordHash, confirm } = options;
  const errors = [];
  const checks = {
    length: false,
    hasLetters: false,
    hasNumbersOrSymbols: false,
    hasUpper: false,
    hasLower: false,
    hasSpecial: false,
    match: true,
    notCurrent: true,
  };

  const str = String(password || '');

  // 1. Length (minimum 8 characters)
  checks.length = str.length >= 8;
  if (!checks.length) {
    errors.push('Password must be at least 8 characters long.');
  }

  // 2. Contains letters
  checks.hasLetters = /[A-Za-z]/.test(str);
  if (!checks.hasLetters) {
    errors.push('Password must contain at least one letter.');
  }

  // 3. Contains numbers or symbols
  checks.hasNumbersOrSymbols = /[0-9]/.test(str) || /[^A-Za-z0-9]/.test(str);
  if (!checks.hasNumbersOrSymbols) {
    errors.push('Password must contain at least one number or special character.');
  }

  // Bonus checks for strength
  checks.hasUpper = /[A-Z]/.test(str);
  checks.hasLower = /[a-z]/.test(str);
  checks.hasSpecial = /[^A-Za-z0-9]/.test(str);

  // 4. Confirm match
  if (confirm !== undefined) {
    checks.match = str === String(confirm || '');
    if (!checks.match) {
      errors.push('New passwords do not match. Please verify your confirm password.');
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
  if (checks.hasLetters && checks.hasNumbersOrSymbols) score++;
  if (checks.hasUpper && checks.hasLower) score++;
  if (checks.hasSpecial) score++;
  if (str.length >= 12 && score >= 3) score++;

  return {
    valid: errors.length === 0,
    errors,
    checks,
    score: Math.min(5, Math.max(1, score)),
  };
}

module.exports = { validatePassword };
