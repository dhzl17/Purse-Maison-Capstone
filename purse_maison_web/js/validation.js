/**
 * Validation rules shared by every form.
 * The database enforces the same rules (migration 0026_input_validation.sql), so a value that slips past
 * the browser is still rejected. These checks exist to give staff a clear message before anything is saved.
 *
 * Each check returns an error message (string) or null when the value is fine.
 * Use Validate.first(...) to get the first problem from a list of checks.
 */
const Validate = {
  /** Latin letters including ñ, é, ü and other accented letters. */
  LETTERS: 'A-Za-zÀ-ÖØ-öø-ÿĀ-ž',
  MAX_AMOUNT: 50000000,
  MAX_APPOINTMENT_DAYS: 365,

  clean(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
  },

  letterCount(v) {
    return (v.match(new RegExp(`[${this.LETTERS}]`, 'g')) || []).length;
  },

  /** Returns the first error message in the list, or null when every check passed. */
  first(...results) {
    return results.find((r) => r) || null;
  },

  /** Person names: letters, spaces, period, hyphen, apostrophe. e.g. "Ma. Clara Dela Cruz-O'Neil" */
  personName(value, label = 'Name', required = true) {
    const v = this.clean(value);
    if (!v) return required ? `Enter the ${label.toLowerCase()}.` : null;
    if (v.length > 100) return `${label} must be 100 characters or fewer.`;
    if (!new RegExp(`^[${this.LETTERS}][${this.LETTERS} .'’-]*$`).test(v)) {
      return `${label} can only contain letters, spaces, periods (.), hyphens (-) and apostrophes (').`;
    }
    if (this.letterCount(v) < 2) return `${label} must have at least 2 letters.`;
    if (new RegExp(`([${this.LETTERS}])\\1{3}`, 'i').test(v)) return `${label} looks mistyped (the same letter 4 or more times in a row).`;
    if (/[.'’-]{2}/.test(v)) return `${label} has repeated punctuation.`;
    return null;
  },

  /** Philippine mobile numbers: 09XXXXXXXXX or +639XXXXXXXXX. Spaces and dashes are ignored. */
  phone(value, label = 'Phone number', required = false) {
    const v = String(value ?? '').replace(/[\s-]/g, '');
    if (!v) return required ? `Enter the ${label.toLowerCase()}.` : null;
    if (!/^(09|\+639)\d{9}$/.test(v)) return `${label} must be a PH mobile number, e.g. 0917 123 4567 or +63 917 123 4567.`;
    return null;
  },

  /** Saves phone numbers in one format (09171234567) so duplicates are easy to spot. */
  normalizePhone(value) {
    const v = String(value ?? '').replace(/[\s-]/g, '');
    if (!v) return '';
    return v.startsWith('+63') ? `0${v.slice(3)}` : v;
  },

  email(value, label = 'Email', required = false) {
    const v = String(value ?? '').trim();
    if (!v) return required ? `Enter the ${label.toLowerCase()}.` : null;
    if (v.length > 120 || !/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(v)) return `${label} is not a valid email address, e.g. maria@gmail.com.`;
    return null;
  },

  /** Brand, model, color, hardware, date code, listing title. Must contain a letter. e.g. "Dolce & Gabbana", "Birkin 30" */
  itemText(value, label, required = false, max = 120) {
    const v = this.clean(value);
    if (!v) return required ? `Enter the ${label.toLowerCase()}.` : null;
    if (v.length > max) return `${label} must be ${max} characters or fewer.`;
    if (!new RegExp(`^[0-9${this.LETTERS} &.,'’()/+#;:!–-]+$`).test(v)) {
      return `${label} has characters that are not allowed. Use letters, numbers, spaces and & . , ' ( ) / + # -`;
    }
    if (this.letterCount(v) < 1) return `${label} must contain letters, not only numbers or symbols.`;
    if (/(.)\1{4}/.test(v)) return `${label} looks mistyped (the same character 5 or more times in a row).`;
    return null;
  },

  /** Serial number, microchip number, payment reference: letters, numbers, hyphen and slash. e.g. "SN-88492019" */
  code(value, label, required = false) {
    const v = String(value ?? '').trim();
    if (!v) return required ? `Enter the ${label.toLowerCase()}.` : null;
    if (!/^[A-Za-z0-9/-]{2,40}$/.test(v)) return `${label} can only contain letters, numbers, hyphens (-) and slashes (/), 2–40 characters, no spaces.`;
    if (/(.)\1{7}/.test(v)) return `${label} looks mistyped (the same character 8 or more times in a row).`;
    return null;
  },

  /** Notes and descriptions: must read like words, not symbols or a held-down key. */
  notes(value, label = 'Notes', required = false, max = 2000) {
    const v = String(value ?? '').trim();
    if (!v) return required ? `Enter the ${label.toLowerCase()}.` : null;
    if (v.length > max) return `${label} must be ${max} characters or fewer.`;
    if (this.letterCount(v) < 3) return `${label} must contain words (at least 3 letters).`;
    if (/(\S)\1{5}/.test(v)) return `${label} looks mistyped (the same character 6 or more times in a row).`;
    const visible = v.replace(/\s/g, '');
    const wordChars = (visible.match(new RegExp(`[0-9${this.LETTERS}]`, 'g')) || []).length;
    if (wordChars * 10 < visible.length * 6) return `${label} has too many symbols. Write it in words.`;
    return null;
  },

  /** Prices and amounts in pesos. Whole pesos unless decimals is set (layaway payments allow centavos). */
  amount(value, label, required = true, decimals = 0) {
    const raw = String(value ?? '').trim();
    if (!raw) return required ? `Enter the ${label.toLowerCase()}.` : null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return `${label} must be a number above ₱0.`;
    if (n > this.MAX_AMOUNT) return `${label} cannot be more than ₱${this.MAX_AMOUNT.toLocaleString('en-PH')}.`;
    if (Math.round(n * 10 ** decimals) !== n * 10 ** decimals) {
      return decimals ? `${label} can have at most ${decimals} decimal places.` : `${label} must be in whole pesos (no centavos).`;
    }
    return null;
  },

  // ------------------------------------------------------------------ date & time

  /** Formats a date for a datetime-local input ("2026-10-28T23:40"), in the computer's time zone. */
  toLocalInput(date) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  },

  /** Stops the calendar from offering past dates (and dates more than a year ahead). */
  limitToFuture(input) {
    if (!input) return;
    const update = () => {
      const now = new Date();
      input.min = this.toLocalInput(now);
      input.max = this.toLocalInput(new Date(now.getTime() + this.MAX_APPOINTMENT_DAYS * 86400000));
    };
    update();
    input.addEventListener('focus', update); // keeps "now" current if the page stays open
  },

  /** A date and time that must not be in the past. value is the datetime-local string. */
  futureDateTime(value, label = 'Date and time') {
    if (!value) return `Choose the ${label.toLowerCase()}.`;
    const t = new Date(value);
    if (Number.isNaN(t.getTime())) return `${label} is not a valid date.`;
    if (t.getTime() < Date.now()) return `${label} cannot be in the past.`;
    if (t.getTime() > Date.now() + this.MAX_APPOINTMENT_DAYS * 86400000) return `${label} must be within the next 12 months.`;
    return null;
  },
};
