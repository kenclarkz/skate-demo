// The player's own parks, kept in localStorage as a simple array of files.
// Everything else — a file's shape, how it becomes a rideable Park — lives in
// parkFile.js; this module only knows how to keep the list safe.

import { validate } from './parkFile.js';

const KEY = 'skate.parks';

/** Every saved park file, validated, in creation order. putFile stores each
 * file as an object inside the array, so they come back as objects — validate
 * clamps them straight from that shape, no re-serialising needed. */
export function listFiles() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((f) => validate(f)).filter(Boolean);
  } catch {
    return [];
  }
}

export function getFile(id) {
  return listFiles().find((f) => f.id === id) || null;
}

/** Upsert — a new park is pushed on the end, an existing one replaced in
 * place so the list's order is the order the parks were created in. */
export function putFile(file) {
  const files = listFiles();
  const i = files.findIndex((f) => f.id === file.id);
  if (i >= 0) files[i] = file;
  else files.push(file);
  try {
    localStorage.setItem(KEY, JSON.stringify(files));
  } catch {
    // A full localStorage must never take the editor down with it — the
    // current session keeps working, it just cannot be saved.
  }
}

export function removeFile(id) {
  try {
    const files = listFiles().filter((f) => f.id !== id);
    localStorage.setItem(KEY, JSON.stringify(files));
  } catch {
    // Same as putFile: failure to write is not worth interrupting a session.
  }
}
