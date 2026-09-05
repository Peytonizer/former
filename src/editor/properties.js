/**
 * editor/properties.js — the per-placement properties panel.
 *
 * Reads and writes `placements.js`'s `Placement[]` through the same `onChange` callback the
 * editor canvas uses; this module owns no state beyond which placement is currently shown.
 *
 * Value and options are applied with `updateGroup`, not `updatePlacement` — SPEC.md's "same
 * field as…" model means a field's value must be identical across every widget sharing its
 * name, not just the one being edited (see `placements.js`, `updateGroup`). `name`, `optionValue`
 * and `fontSize` are per-widget and use plain `updatePlacement` instead: `optionValue` is a
 * radio widget's own fixed option, never shared, and `fontSize` isn't wired into any writer's
 * field creation yet (that lands with fonts.js at stage 11), so there is nothing to keep in sync
 * across a group for it today.
 */
import { updateGroup, updatePlacement } from '../placements.js';

/**
 * @param {{
 *   container: HTMLElement,
 *   getPlacements: () => import('../placements.js').Placement[],
 *   onChange: (next: import('../placements.js').Placement[]) => void,
 * }} args
 */
export function createPropertiesPanel({ container, getPlacements, onChange }) {
  const els = {
    name: container.querySelector('[data-prop-name]'),
    existingNames: container.querySelector('[data-existing-names]'),
    rowText: container.querySelector('[data-prop-row-text]'),
    valueText: container.querySelector('[data-prop-value-text]'),
    rowCheck: container.querySelector('[data-prop-row-check]'),
    valueCheck: container.querySelector('[data-prop-value-check]'),
    rowDropdown: container.querySelector('[data-prop-row-dropdown]'),
    options: container.querySelector('[data-prop-options]'),
    valueSelect: container.querySelector('[data-prop-value-select]'),
    rowRadio: container.querySelector('[data-prop-row-radio]'),
    optionValue: container.querySelector('[data-prop-option-value]'),
    radioSelected: container.querySelector('[data-prop-radio-selected]'),
    rowFontSize: container.querySelector('[data-prop-row-fontsize]'),
    fontSize: container.querySelector('[data-prop-fontsize]'),
    rowSignature: container.querySelector('[data-prop-row-signature]'),
  };

  let currentId = null;

  function current() {
    return getPlacements().find((p) => p.id === currentId) ?? null;
  }

  function render() {
    const placement = current();
    if (!placement) {
      container.hidden = true;
      return;
    }
    container.hidden = false;

    els.name.value = placement.name;

    // "Same field as…" — every other name already in use in the document.
    const names = new Set(getPlacements().map((p) => p.name).filter(Boolean));
    names.delete(placement.name);
    els.existingNames.replaceChildren(
      ...[...names].map((name) => {
        const option = document.createElement('option');
        option.value = name;
        return option;
      }),
    );

    els.rowText.hidden = placement.type !== 'text';
    els.rowCheck.hidden = placement.type !== 'check';
    els.rowDropdown.hidden = placement.type !== 'dropdown';
    els.rowRadio.hidden = placement.type !== 'radio';
    els.rowFontSize.hidden = placement.type !== 'text' && placement.type !== 'dropdown';
    els.rowSignature.hidden = placement.type !== 'signature';

    if (placement.type === 'text') {
      els.valueText.value = placement.value || '';
    } else if (placement.type === 'check') {
      els.valueCheck.checked = Boolean(placement.value);
    } else if (placement.type === 'dropdown') {
      els.options.value = placement.options.join('\n');
      els.valueSelect.replaceChildren(
        ...placement.options.map((opt) => {
          const option = document.createElement('option');
          option.value = opt;
          option.textContent = opt;
          option.selected = opt === placement.value;
          return option;
        }),
      );
    } else if (placement.type === 'radio') {
      els.optionValue.value = placement.optionValue || '';
      els.radioSelected.checked = Boolean(placement.optionValue) && placement.optionValue === placement.value;
    }

    if (placement.type === 'text' || placement.type === 'dropdown') {
      els.fontSize.value = placement.fontSize;
    }
  }

  /** Apply a patch to only the current placement. */
  function commit(patch) {
    if (!currentId) return;
    onChange(updatePlacement(getPlacements(), currentId, patch));
    render();
  }

  /** Apply a patch to every placement sharing the current one's name. */
  function commitGroup(patch) {
    const placement = current();
    if (!placement) return;
    onChange(updateGroup(getPlacements(), placement.name, patch));
    render();
  }

  els.name.addEventListener('change', () => commit({ name: els.name.value.trim() }));
  els.valueText.addEventListener('input', () => commitGroup({ value: els.valueText.value }));
  els.valueCheck.addEventListener('change', () => commitGroup({ value: els.valueCheck.checked }));
  els.valueSelect.addEventListener('change', () => commitGroup({ value: els.valueSelect.value }));
  els.optionValue.addEventListener('change', () => commit({ optionValue: els.optionValue.value.trim() }));
  els.fontSize.addEventListener('change', () => commit({ fontSize: Number(els.fontSize.value) || 0 }));

  els.options.addEventListener('change', () => {
    const options = els.options.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    commitGroup({ options });
  });

  els.radioSelected.addEventListener('change', () => {
    const placement = current();
    if (!placement) return;
    commitGroup({ value: els.radioSelected.checked ? placement.optionValue : '' });
  });

  return {
    /** @param {string|null} id */
    select(id) {
      currentId = id;
      render();
    },
    render,
  };
}
