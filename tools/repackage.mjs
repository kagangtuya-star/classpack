#!/usr/bin/env node
/**
 * Re-extract every compendium pack with a CJK-preserving naming scheme.
 *
 * This script round-trips the JSON through the Foundry VTT CLI
 * (`compilePack` then `extractPack`) using `transformName` / `transformFolderName`
 * from `lib/pack-utils.mjs`, so file and folder names keep their Chinese
 * characters (e.g. "EGW 荒洲探险家指南_<id>.json") instead of the CLI default
 * "EGW_______<id>.json".
 *
 * Usage:
 *   node tools/repackage.mjs            # all packs
 *   node tools/repackage.mjs races-item # a single pack (useful for testing)
 *
 * Requires the Foundry VTT CLI to be installed globally:
 *   npm install -g @foundryvtt/foundryvtt-cli
 */
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import {
  PACKS_ROOT, transformName, transformFolderName, loadCliApi, removeJson, copyTree, listPackNames
} from "./lib/pack-utils.mjs";

const { compilePack, extractPack } = await loadCliApi();

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

    await removeJson(packDir);
    await copyTree(outDir, packDir);

    console.log(`[${name}] done`);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

const target = process.argv[2];
const names = target ? [target] : await listPackNames();
if ( !names.length ) {
  console.error(`No packs found under ${PACKS_ROOT}`);
  process.exit(1);
}
for ( const name of names ) await processPack(name);
console.log("\nAll done.");
