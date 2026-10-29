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

  /** New password rules. Returns every rule that is not met, so they can be listed together. */
  passwordRules(value, min, current) {
    const v = String(value ?? '');
    if (!v) return ['Enter a new password.'];
    const out = [];
    if (v.length < min) out.push(`Must have at least ${min} characters (${v.length} so far).`);
    if (current && v === current) out.push('Must be different from your current password.');
    return out;
  },

  // ------------------------------------------------------------------ inline messages

  /**
   * Shows each problem under its field: red border and a pink box with the message(s).
   *   if (Validate.show(form, [[input, Validate.email(...)], [other, ['Rule 1', 'Rule 2']]])) return;
   * Each check is [field, message | list of messages | true | null]. true marks the field red with no
   * message. field is an element or a CSS selector inside root.
   * root: clears every old message inside it first. Pass null to clear only the fields being checked
   * (for single fields in a panel that holds other forms). Returns true when there was at least one problem.
   */
  show(root, checks) {
    if (root) this.clear(root);
    else checks.forEach(([target]) => { if (typeof target !== 'string') this.unmark(target); });
    let first = null;
    for (const [target, result] of checks) {
      if (!result || (Array.isArray(result) && !result.length)) continue;
      const messages = result === true ? [] : [].concat(result).filter(Boolean);
      const field = typeof target === 'string' ? root.querySelector(target) : target;
      if (!field) { if (messages.length) showToast(messages[0]); continue; }
      this.mark(field, messages);
      if (!first) first = field;
    }
    if (first) {
      first.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (typeof first.focus === 'function') first.focus({ preventScroll: true });
    }
    return !!first;
  },

  /** Marks one field as invalid and puts the message box under it (or under its input row). */
  mark(field, messages) {
    this.unmark(field);
    field.classList.add('is-invalid');
    field.setAttribute('aria-invalid', 'true');
    const clear = () => this.unmark(field);
    // The message goes away as soon as the field is changed (or, for the signature pad, drawn on)
    const events = field.matches('input, select, textarea') ? ['input', 'change'] : ['input', 'change', 'pointerdown'];
    events.forEach((ev) => field.addEventListener(ev, clear, { once: true }));
    if (!messages.length) return;
    const box = document.createElement('ul');
    box.className = 'field-error';
    box.id = `field-error-${Math.random().toString(36).slice(2, 9)}`;
    box.setAttribute('role', 'alert');
    box.innerHTML = messages.map((m) => `<li>${escapeHtml(m)}</li>`).join('');
    field.setAttribute('aria-describedby', box.id);
    field._fieldError = box;
    // Under an input row (input + button side by side, or the password eye button) rather than inside it
    const parent = field.parentElement;
    let anchor = field;
    if (parent && !parent.classList.contains('field-group')
        && (parent.classList.contains('field-input-wrap') || getComputedStyle(parent).display === 'flex')) anchor = parent;
    while (anchor.nextElementSibling && anchor.nextElementSibling.classList.contains('field-error')) anchor = anchor.nextElementSibling;
    anchor.after(box);
  },

  unmark(field) {
    if (!field) return;
    field.classList.remove('is-invalid');
    field.removeAttribute('aria-invalid');
    field.removeAttribute('aria-describedby');
    if (field._fieldError) { field._fieldError.remove(); field._fieldError = null; }
  },

  /** Removes every inline message inside root. */
  clear(root) {
    if (!root) return;
    root.querySelectorAll('.is-invalid').forEach((el) => this.unmark(el));
    root.querySelectorAll('.field-error').forEach((el) => el.remove());
  },
};
