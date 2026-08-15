/**
 * One-time world migration: the "new-icon" compendium pack was renamed "spell".
 *
 * The pack identifier changed from "new-icon" to "spell". Worlds created before
 * that change may still hold UUID references to the old identifier
 * (Compendium.dnd5e_classpack.new-icon.…) inside their own documents — imported
 * actors, items, journal entries, macros, scenes, and so on. This module
 * rewrites those references in place the first time the world is loaded after
 * the update, so existing content keeps resolving to the renamed pack.
 */

const MODULE_ID = "dnd5e_classpack";
const SETTING_KEY = "newIconToSpellMigrated";
const OLD_PREFIX = "Compendium.dnd5e_classpack.new-icon.";
const NEW_PREFIX = "Compendium.dnd5e_classpack.spell.";

/**
 * Recursively replace every occurrence of OLD_PREFIX within a data structure.
 * @param {*} value  Any JSON-serializable value.
 * @returns {*}      A new value with the prefix replaced.
 */
function deepReplace(value) {
  if ( typeof value === "string" ) return value.split(OLD_PREFIX).join(NEW_PREFIX);
  if ( Array.isArray(value) ) return value.map(deepReplace);
  if ( value && typeof value === "object" ) {
    const result = {};
    for ( const [key, entry] of Object.entries(value) ) result[key] = deepReplace(entry);
    return result;
  }
  return value;
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTING_KEY, {
    name: "new-icon → spell 迁移标记",
    hint: "内部标记，记录旧 new-icon 包引用是否已迁移到新的 spell 包名。",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
});

Hooks.once("ready", async () => {
  if ( !game.user.isGM ) return;
  if ( game.settings.get(MODULE_ID, SETTING_KEY) ) return;

  const collections = [
    game.actors,
    game.items,
    game.journal,
    game.macros,
    game.tables,
    game.scenes,
    game.playlists,
    game.folders
  ].filter(Boolean);

  let updated = 0;
  let failed = 0;

  for ( const collection of collections ) {
    for ( const doc of collection.contents ) {
      const original = doc.toObject();
      const migrated = deepReplace(original);
      const changes = foundry.utils.diffObject(original, migrated);
      if ( Object.keys(changes).length === 0 ) continue;
      try {
        await doc.update(changes, { diff: true });
        updated++;
      } catch ( err ) {
        failed++;
        console.error(`[${MODULE_ID}] 迁移 ${doc.documentName}#${doc.id} 失败:`, err);
      }
    }
  }

  await game.settings.set(MODULE_ID, SETTING_KEY, true);
  console.log(`[${MODULE_ID}] new-icon → spell 迁移完成：更新 ${updated} 个文档，失败 ${failed} 个。`);
});
