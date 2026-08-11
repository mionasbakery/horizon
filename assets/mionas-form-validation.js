/**
 * Renders a Mionas form's client-side validation errors as design-system markup instead of letting
 * the browser draw its native bubble.
 *
 * The browser's own constraints stay the source of truth -- `required` and `type="email"` are still
 * emitted by snippets/mionas-text-field.liquid and still populate ValidityState. Only the
 * PRESENTATION changes: this element reads that state and writes the exact classes and markup that
 * snippets/mionas-form-field.liquid, mionas-form-label.liquid and mionas-form-error.liquid produce
 * server-side, so a client-side error and a Shopify-rejected one are indistinguishable in the DOM.
 *
 * `novalidate` IS SET FROM HERE, NEVER FROM LIQUID. That is what suppresses the bubble, and putting
 * it in JS means a visitor without JavaScript keeps native HTML5 validation rather than losing
 * validation altogether. Do not move it into the {% form %} tag.
 *
 * Deliberately NOT a `Component` subclass, and deliberately not named `*-component`:
 * assets/component.js resolves `on:` bindings to the closest ancestor that is a `Component` or whose
 * tag name ends in `-component` (see getClosestComponent). Staying out of that lookup keeps this
 * element from intercepting anything inside the form.
 */

const FIELD_SELECTOR = '.mionas-form-field';
const LABEL_SELECTOR = '.mionas-form-label';

const DEFAULT_MESSAGES = {
  required: 'Completa este campo.',
  invalid: 'Revisa este campo.',
};

class MionasFormValidation extends HTMLElement {
  /** @type {HTMLFormElement | null} */
  #form = null;

  /**
   * Fields that have already reported an error, and so should re-validate as the user types. Before
   * the first submit a field is absent from this set and stays silent -- errors appear on submit,
   * not on every keystroke.
   * @type {Set<HTMLInputElement | HTMLTextAreaElement>}
   */
  #live = new Set();

  connectedCallback() {
    this.#form = this.closest('form');
    if (!this.#form) return;

    this.#form.noValidate = true;

    // On `document` in the CAPTURE phase, and that is the whole point -- do not "simplify" it onto
    // the form. Shopify injects its own captcha listener on the form, and it is registered before
    // this element exists, so a listener on the form would run AFTER it: the challenge would
    // already be under way by the time we called preventDefault, and the visitor would get a
    // captcha for a submission we were never going to allow. A capture listener on the document
    // runs before any listener on the form, which is what lets us stop the event dead.
    //
    // SUBMIT ONLY -- there was briefly a matching capture listener for `click` here, and it must
    // not come back. A <button> with no type attribute reports type "submit", and any button
    // inside the form reports that form as its .form, so a document-wide click interceptor also
    // swallowed the buttons password managers inject next to the field. The symptom was precise
    // and horrible to diagnose: 1Password's dropdown appeared, you clicked an entry, and nothing
    // happened -- but only while the field was invalid, which is exactly when you reach for
    // autofill. Blocking the submit event alone is enough to keep the captcha out of it.
    document.addEventListener('submit', this.#handleSubmit, true);
    this.#form.addEventListener('input', this.#handleInput);

    // Adopt whatever Liquid already rendered. After a Shopify rejection the page is a fresh
    // document with the error markup in place but this element newly constructed, so without this
    // the field would not be in #live and the message would sit there unclearable while the user
    // retypes. aria-invalid is the right predicate: snippets/mionas-text-field.liquid sets it on
    // exactly the same condition it renders the message on.
    for (const control of this.#controls()) {
      if (control.getAttribute('aria-invalid') === 'true') this.#live.add(control);
    }
  }

  disconnectedCallback() {
    // The listeners live on an ANCESTOR, not on this element, so they outlive it unless removed
    // explicitly -- and the theme editor re-renders a block on every setting change.
    document.removeEventListener('submit', this.#handleSubmit, true);
    this.#form?.removeEventListener('input', this.#handleInput);

    // Hand validation back to the browser. Leaving noValidate set after the handler is gone would
    // strand the form with NO validation at all -- worse than the bubble this element replaces.
    if (this.#form) this.#form.noValidate = false;

    this.#form = null;
    this.#live.clear();
  }

  /**
   * Every submission of this form, however it was triggered -- the button, or Enter in a text
   * field. Caught at the document before anything on the form can see it.
   *
   * @param {SubmitEvent} event
   */
  #handleSubmit = (event) => {
    if (event.target !== this.#form) return;
    this.#reject(event);
  };

  /**
   * Validates and, if anything fails, kills the event outright. Returns nothing: a valid form is
   * simply left alone, event untouched, so Shopify's captcha and everything else behave exactly as
   * they did before this element existed.
   *
   * @param {Event} event
   */
  #reject = (event) => {
    const invalid = this.#controls().filter((control) => !control.checkValidity());
    if (invalid.length === 0) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    for (const control of invalid) {
      this.#live.add(control);
      this.#showError(control, this.#messageFor(control));
    }

    // aria-describedby is set by #showError before focus moves, which is what makes a screen reader
    // read the message on arrival -- the same mechanism the server-rendered path gets from the
    // `autofocus` in snippets/mionas-text-field.liquid. Only the FIRST invalid field is focused, for
    // the same reason that snippet allows only one autofocus.
    invalid[0]?.focus();
  };

  /**
   * @param {Event} event
   */
  #handleInput = (event) => {
    const control = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (event.target);
    if (!this.#live.has(control)) return;
    if (!control.checkValidity()) return;

    this.#clearError(control);
    this.#live.delete(control);
  };

  /**
   * Every control the browser would validate. `willValidate` is false for disabled, hidden and
   * button-type controls, which is exactly the set to skip -- including the hidden contact[id] and
   * form_type inputs Shopify's form tag emits.
   * @returns {Array<HTMLInputElement | HTMLTextAreaElement>}
   */
  #controls() {
    if (!this.#form) return [];
    return /** @type {Array<HTMLInputElement | HTMLTextAreaElement>} */ (
      Array.from(this.#form.elements)
    ).filter((element) => 'willValidate' in element && element.willValidate);
  }

  /**
   * Per-input overrides win over the form-wide copy, so a form with a non-email required field can
   * word its own message without a new snippet param -- pass them through
   * snippets/mionas-text-field.liquid's `attributes`.
   *
   * validationMessage is the last resort rather than the default: it is worded in the BROWSER's
   * language, not the store's, so it is only reached for constraints this element does not name
   * (tooShort, rangeOverflow, ...), where a wrong-language message still beats an empty one.
   *
   * @param {HTMLInputElement | HTMLTextAreaElement} control
   * @returns {string}
   */
  #messageFor(control) {
    const validity = control.validity;

    if (validity.valueMissing) {
      return (
        control.dataset.messageRequired || this.dataset.messageRequired || DEFAULT_MESSAGES.required
      );
    }

    if (validity.typeMismatch || validity.patternMismatch) {
      return (
        control.dataset.messageInvalid || this.dataset.messageInvalid || DEFAULT_MESSAGES.invalid
      );
    }

    return control.validationMessage || this.dataset.messageInvalid || DEFAULT_MESSAGES.invalid;
  }

  /**
   * Writes the same three things Liquid writes: the field's error modifier, the label's error
   * modifier, and the message paragraph. Do not "simplify" this by styling with :user-invalid
   * instead -- CSS can colour the underline but cannot produce the message string.
   *
   * @param {HTMLInputElement | HTMLTextAreaElement} control
   * @param {string} message
   */
  #showError(control, message) {
    const field = control.closest(FIELD_SELECTOR);
    if (!field) return;

    field.classList.add('mionas-form-field--error');
    field.querySelector(LABEL_SELECTOR)?.classList.add('mionas-form-label--error');

    const errorId = `${control.id}-error`;

    // Reuse before create. A server-rejected value that is re-submitted UNEDITED already has a
    // Liquid-rendered message with this id; appending a second one would duplicate the id and show
    // the message twice.
    let node = field.querySelector(`#${CSS.escape(errorId)}`);
    if (!node) {
      node = document.createElement('p');
      node.className = 'mionas-form-error';
      node.id = errorId;
      field.append(node);
    }
    node.textContent = message;

    control.setAttribute('aria-invalid', 'true');
    control.setAttribute('aria-describedby', errorId);
  }

  /**
   * The message node is REMOVED, not emptied. snippets/mionas-form-error.liquid renders nothing at
   * all when blank for the same reason: .mionas-form-field is a flex column with a gap, so an empty
   * paragraph would still consume one and leave the underline sitting too low.
   *
   * @param {HTMLInputElement | HTMLTextAreaElement} control
   */
  #clearError(control) {
    const field = control.closest(FIELD_SELECTOR);
    if (!field) return;

    field.classList.remove('mionas-form-field--error');
    field.querySelector(LABEL_SELECTOR)?.classList.remove('mionas-form-label--error');
    field.querySelector(`#${CSS.escape(`${control.id}-error`)}`)?.remove();

    control.removeAttribute('aria-invalid');
    control.removeAttribute('aria-describedby');
  }
}

if (!customElements.get('mionas-form-validation')) {
  customElements.define('mionas-form-validation', MionasFormValidation);
}
