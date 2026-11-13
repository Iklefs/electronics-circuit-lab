import { validateChip } from "./logic-circuit.js";

export const chipId = /^chip-[a-z0-9-]{1,50}$/;
export const chipLibrary = new Map();
const storageKey = "circuit-lab.logic-chips.v1";

function loadChips(value) {
  try {
    const saved = JSON.parse(value);
    if (!Array.isArray(saved)) return;
    for (const entry of saved.slice(-32)) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || !chipId.test(entry[0])) continue;
      try {
        const chip = validateChip(entry[1]);
        chipLibrary.delete(entry[0]);
        chipLibrary.set(entry[0], chip);
      } catch {
        // Skip an invalid entry without hiding other saved chips.
      }
    }
  } catch {
    // An invalid storage value does not overwrite the current library.
  }
}

try {
  loadChips(localStorage.getItem(storageKey));
} catch {
  // Storage can be disabled.
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey) return;
    loadChips(event.newValue);
    window.dispatchEvent(new Event("logic-chips-change"));
  });
}

export function saveChipLibrary() {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...chipLibrary].slice(-32)));
  } catch {
    // Imported chips remain available in this tab.
  }
  window.dispatchEvent(new Event("logic-chips-change"));
}
