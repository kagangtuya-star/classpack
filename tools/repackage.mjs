#!/usr/bin/env node
/**
 * Re-extract every compendium pack with a custom `transformName` /
 * `transformFolderName` that PRESERVES CJK (Chinese) characters in file and
 * directory names.
 *
 * The CLI's default `getSafeFilename()` strips everything outside a-zA-Z0-9 and
 * Cyrillic, so a name like "EGW 荒洲探险家指南" becomes "EGW_______". This script
 * instead only removes characters that are illegal in file/directory names,
 * producing "EGW 荒洲探险家指南_<id>" while keeping the `_id` suffix that
 * guarantees uniqueness.
 *
 * The packer (`fvtt package pack --recursive`) does not read file/directory
 * names at all — it only uses the JSON contents and the `.json` extension — so
 * this renaming is purely cosmetic and does not affect the compiled packs.
 *
 * Usage:
 *   node tools/repackage.mjs            # all packs
 *   node tools/repackage.mjs races-item # a single pack (useful for testing)
 *
 * Requires the Foundry VTT CLI to be installed globally:
 *   npm install -g @foundryvtt/foundryvtt-cli
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKS_ROOT = path.resolve(__dirname, "..", "dnd5e_classpack", "packs");

/**
 * Filesystem-safe but CJK-preserving name sanitizer. Unlike the CLI's
 * getSafeFilename (which keeps only [a-zA-Z0-9] + Cyrillic), this only removes
 * characters that are illegal in file/directory names.
 * @param {*} name
 * @returns {string}
 */
function safeName(name) {
  if ( name == null ) return "";
  return String(name)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_") // illegal + control chars
    .replace(/^\.+/, "")                          // leading dots
    .replace(/[. ]+$/, "")                        // trailing dots/spaces (Windows)
    .trim() || "_";
}

/**
 * Filename for a regular document: "<名称>_<id>.json". Folder documents return
 * undefined so the CLI's default `_Folder.json` logic runs (it places the file
 * inside the folder directory named by `transformFolderName`).
 * @param {object} doc
 * @param {{documentType?: string, folder?: string}} [context]
 * @returns {string|undefined}
 */
function transformName(doc, { folder } = {}) {
  if ( doc._key?.startsWith("!folders!") ) return undefined;
  const base = doc.name ? `${safeName(doc.name)}_${doc._id}` : doc._id;
  const filename = `${base}.json`;
  return folder ? path.join(folder, filename) : filename;
}

/**
 * Directory name for a Folder document.
 * @param {object} doc
 * @returns {string}
 */
function transformFolderName(doc) {
  return doc.name ? `${safeName(doc.name)}_${doc._id}` : doc._id;
}

async function listPackNames() {
  const entries = await fsp.readdir(PACKS_ROOT, { withFileTypes: true });
  return entries.filter(e => e.isDirectory()).map(e => e.name).sort();
}

async function processPack(name) {
  const packDir = path.join(PACKS_ROOT, name);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), `classpack-${name}-`));
  const ldbDir = path.join(tmp, "ldb");
  const outDir = path.join(tmp, "out");

  try {
    console.log(`[${name}] compiling JSON -> LevelDB ...`);
    await compilePack(packDir, ldbDir, { recursive: true, log: false });

    console.log(`[${name}] extracting LevelDB -> JSON (CJK-preserving names) ...`);
    await extractPack(ldbDir, outDir, {
      folders: true,
      transformName,
      transformFolderName,
      log: false
    });

    // Remove existing JSON, keeping any non-JSON files (e.g. token images).
    const removeJson = async dir => {
      for ( const e of await fsp.readdir(dir, { withFileTypes: true }) ) {
        const p = path.join(dir, e.name);
        if ( e.isDirectory() ) await removeJson(p);
        else if ( e.name.endsWith(".json") ) await fsp.rm(p, { force: true });
      }
      // Prune directories left empty after their JSON was removed.
      const remaining = await fsp.readdir(dir);
      if ( remaining.length === 0 && dir !== packDir ) await fsp.rmdir(dir);
    };
    await removeJson(packDir);

    // Copy the freshly extracted JSON back into the pack directory.
    const copyTree = async (src, dst) => {
      await fsp.mkdir(dst, { recursive: true });
      for ( const e of await fsp.readdir(src, { withFileTypes: true }) ) {
        const s = path.join(src, e.name);
        const d = path.join(dst, e.name);
        if ( e.isDirectory() ) await copyTree(s, d);
        else await fsp.copyFile(s, d);
      }
    };
    await copyTree(outDir, packDir);

    console.log(`[${name}] done`);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

// Resolve the globally installed Foundry VTT CLI (ESM) and import its API.
const globalRoot = spawnSync("npm", ["root", "-g"], { encoding: "utf8", shell: true }).stdout.trim();
const cliEntry = path.join(globalRoot, "@foundryvtt", "foundryvtt-cli", "index.mjs");
if ( !fs.existsSync(cliEntry) ) {
  console.error(`Foundry VTT CLI not found at ${cliEntry}. Install it with:`);
  console.error("  npm install -g @foundryvtt/foundryvtt-cli");
  process.exit(1);
}
const { compilePack, extractPack } = await import(pathToFileURL(cliEntry).href);

const target = process.argv[2];
const names = target ? [target] : await listPackNames();
if ( !names.length ) {
  console.error(`No packs found under ${PACKS_ROOT}`);
  process.exit(1);
}
for ( const name of names ) await processPack(name);
console.log("\nAll done.");
