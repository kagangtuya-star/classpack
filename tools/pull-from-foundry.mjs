#!/usr/bin/env node
/**
 * Pull in-game edits back from a Foundry VTT installation into this repository.
 *
 * In Foundry, compendium packs are stored as compiled LevelDB databases
 * (`.ldb` files) under the module's `packs/<name>/` directory. When you edit
 * the module in-game, only those LevelDB files change — this repository stores
 * JSON source instead. This script bridges the two by unpacking Foundry's
 * LevelDB back to JSON, using the same CJK-preserving naming as the rest of the
 * tooling so git diffs stay clean.
 *
 * Usage:
 *   node tools/pull-from-foundry.mjs --data "<Foundry Data dir>"            # all packs
 *   node tools/pull-from-foundry.mjs --data "<Foundry Data dir>" --pack races-item
 *
 * Options:
 *   -d, --data <path>    The Foundry VTT "Data" directory (the one containing
 *                        `modules/`, `worlds/`, etc.). Found on the Foundry
 *                        Setup screen under "User Data". Defaults to the
 *                        FOUNDRY_DATA_PATH env var or a platform guess.
 *   -m, --module <dir>   The module folder name. Default: dnd5e_classpack.
 *   -p, --pack <name>    Only process this pack (repeatable). Default: all
 *                        packs present in the Foundry module.
 *
 * Important: quit Foundry VTT (or close the world) first — Foundry holds a lock
 * on each pack while it is running.
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import {
  PACKS_ROOT, transformName, transformFolderName, loadCliApi, removeJson, copyTree, isFileLocked
} from "./lib/pack-utils.mjs";

const { extractPack } = await loadCliApi();

function printHelp() {
  console.log(`Usage: node tools/pull-from-foundry.mjs --data "<Foundry Data dir>" [options]

Options:
  -d, --data <path>    Foundry VTT "Data" directory (contains modules/, worlds/).
  -m, --module <dir>   Module folder name (default: dnd5e_classpack).
  -p, --pack <name>    Only this pack (repeatable). Default: all packs.
  -h, --help           Show this help.
`);
}

function parseArgs(argv) {
  const opts = { data: process.env.FOUNDRY_DATA_PATH, module: "dnd5e_classpack", packs: [] };
  for ( let i = 0; i < argv.length; i++ ) {
    const a = argv[i];
    if ( a === "-d" || a === "--data" ) opts.data = argv[++i];
    else if ( a === "-m" || a === "--module" ) opts.module = argv[++i];
    else if ( a === "-p" || a === "--pack" ) opts.packs.push(argv[++i]);
    else if ( a === "-h" || a === "--help" ) { printHelp(); process.exit(0); }
    else { console.error(`Unknown argument: ${a}\n`); printHelp(); process.exit(1); }
  }
  return opts;
}

/** Guess the Foundry VTT Data directory for the current platform. */
function detectFoundryData() {
  const candidates = [];
  if ( process.platform === "win32" ) {
    if ( process.env.LOCALAPPDATA ) candidates.push(path.join(process.env.LOCALAPPDATA, "FoundryVTT", "Data"));
  } else if ( process.platform === "darwin" ) {
    candidates.push(path.join(process.env.HOME, "Library", "Application Support", "FoundryVTT", "Data"));
  } else {
    const xdg = process.env.XDG_DATA_HOME || path.join(process.env.HOME, ".local", "share");
    candidates.push(path.join(xdg, "FoundryVTT", "Data"));
  }
  return candidates.find(c => fs.existsSync(path.join(c, "modules")));
}

const opts = parseArgs(process.argv.slice(2));
const dataRoot = opts.data || detectFoundryData();
const moduleRoot = dataRoot ? path.join(dataRoot, "modules", opts.module) : null;

if ( !dataRoot || !fs.existsSync(moduleRoot) ) {
  console.error("Could not locate this module in a Foundry VTT installation.");
  console.error(`Expected: <Data>/modules/${opts.module}/`);
  console.error("Pass the Foundry Data directory explicitly with --data <path>.");
  console.error("You can find it on the Foundry VTT Setup screen under 'User Data'.");
  process.exit(1);
}

const foundryPacks = path.join(moduleRoot, "packs");
const names = opts.packs.length
  ? opts.packs
  : fs.readdirSync(foundryPacks, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);

let failed = false;
for ( const name of names ) {
  const src = path.join(foundryPacks, name);
  if ( !fs.existsSync(src) ) {
    console.warn(`[${name}] not present in Foundry, skipping`);
    continue;
  }
  if ( isFileLocked(path.join(src, "LOCK")) ) {
    console.error(`[${name}] pack is locked — Foundry VTT is running. Close Foundry VTT and retry.`);
    failed = true;
    continue;
  }

  const dest = path.join(PACKS_ROOT, name);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), `classpack-pull-${name}-`));
  try {
    console.log(`[${name}] extracting Foundry LevelDB -> JSON ...`);
    await extractPack(src, tmp, { folders: true, transformName, transformFolderName, log: false });
    await removeJson(dest);
    await copyTree(tmp, dest);
    console.log(`[${name}] done`);
  } catch ( err ) {
    console.error(`[${name}] failed: ${err.message}`);
    failed = true;
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

if ( failed ) {
  console.error("\nSome packs failed. See messages above.");
  process.exit(1);
}
console.log("\nDone. Review with `git status` / `git diff`, then commit and push.");
