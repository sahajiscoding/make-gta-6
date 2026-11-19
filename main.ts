// Solara Bay — the entrypoint the grader runs (`node main.ts`, Node 22).
//
// It copies the playable game in game/ and the screen captures in screenshots/
// into the output directory and writes dossier.json beside them with the
// vendored make.fun dossier builder, byte for byte what the scorer computes
// from the same tree. Nothing is fetched and nothing is generated at random,
// so two runs on the same commit write the same bytes.
//
//   node main.ts                        → writes to /output
//   MAKEFUN_OUTPUT_DIR=./out node main.ts
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const root = dirname(fileURLToPath(import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The bounty's gate: text_max_bytes shapes the dossier bytes, the rest only
// refuse an entry that is already over a cap.
const caps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

// ---------------------------------------------------------------- checks
// Fail loudly and early on an entry that the gate would refuse anyway.
for (const dir of ['game', 'screenshots']) {
  const path = join(root, dir);
  if (!existsSync(path)) throw new Error(`main.ts: missing ${dir}/ next to main.ts`);
}

const gameIndex = join(root, 'game', 'index.html');
if (!existsSync(gameIndex)) throw new Error('main.ts: game/index.html is required: a game is a folder of static files');

const shots = readdirSync(join(root, 'screenshots')).filter((name) => /\.(png|jpe?g)$/i.test(name) && !name.startsWith('.'));
if (shots.length < 3 || shots.length > 4) {
  throw new Error(`main.ts: screenshots/ holds ${shots.length} images; an entry needs 3 or 4`);
}

// ---------------------------------------------------------------- copy
// A clean output directory keeps the run reproducible: no stale files from an
// earlier build end up in the dossier.
if (existsSync(out)) {
  for (const name of ['game', 'screenshots', 'dossier.json']) {
    rmSync(join(out, name), { recursive: true, force: true });
  }
}
mkdirSync(out, { recursive: true });

for (const dir of ['game', 'screenshots']) {
  cpSync(join(root, dir), join(out, dir), { recursive: true });
}

// ---------------------------------------------------------------- dossier
const dossier = buildDossier(out, caps);
writeFileSync(join(out, 'dossier.json'), dossier);

const count = (dir) => {
  let files = 0;
  let bytes = 0;
  const walk = (p) => {
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      const full = join(p, entry.name);
      if (entry.isDirectory()) walk(full);
      else files++;
    }
  };
  walk(dir);
  return { files, bytes };
};

const gameTree = count(join(out, 'game'));
console.log(`Solara Bay — entry written to ${out}`);
console.log(`  game/        ${gameTree.files} files`);
console.log(`  screenshots/ ${shots.length} images: ${shots.join(', ')}`);
console.log(`  dossier.json ${dossier.length} bytes`);
console.log(`  (${relative(process.cwd(), out) || '.'})`);
