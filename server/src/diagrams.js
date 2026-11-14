// Diagrams load BY NAME from diagram-studio/1 data files (rule 17) — no hand-built nodes/edges in the UI.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../diagrams');

export function listDiagrams() {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
}
export function getDiagram(id) {
  return listDiagrams().find(d => d.id === id) || null;
}
