import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  getSoloInteractionDenial, isSoloCommandEnabled, isSoloModeEnabled,
  loadSoloCommands, loadSoloInteractionHandlers, validateSoloModeConfig,
} from '../src/leaguebuddy/solo_mode.js';

const original = { ...process.env };
try {
  process.env.MADDEN_SOLO_MODE = 'false';
  assert.equal(isSoloModeEnabled(), true, 'Old mode flags must never restore multiplayer');
  delete process.env.MADDEN_SOLO_USER_ID;
  delete process.env.MADDEN_SOLO_GUILD_ID;
  assert.throws(validateSoloModeConfig, /MADDEN_SOLO_USER_ID and MADDEN_SOLO_GUILD_ID/);
  process.env.MADDEN_SOLO_USER_ID = 'operator-1';
  process.env.MADDEN_SOLO_GUILD_ID = 'guild-1';
  assert.equal(validateSoloModeConfig().enabled, true);
  assert.match(getSoloInteractionDenial({ userId: 'other', guildId: 'guild-1' }), /authorized operator/);
  assert.match(getSoloInteractionDenial({ userId: 'operator-1', guildId: 'guild-2' }), /different/);
  assert.ok(getSoloInteractionDenial({ userId: 'operator-1', guildId: null }));
  assert.equal(getSoloInteractionDenial({ userId: 'operator-1', guildId: 'guild-1', commandName: 'setup' }), null);
  const commands = await loadSoloCommands();
  const handlers = await loadSoloInteractionHandlers();
  const removedCommands = ['pricing', 'plan', 'claim-plan', 'activateplan', 'setplan', 'viewplan', 'attachpaymentref', 'viewbilling', 'enablepack', 'member', 'removerole', 'scout', 'myscouts', 'franchisehub', 'fantasy', 'tradeblock', 'create-threads', 'delete-threads', 'activitycheck', 'points', 'weeklyupdate'];
  for (const name of removedCommands) {
    assert.equal(isSoloCommandEnabled(name), false, name);
    assert.equal(commands.has(name), false, name);
    assert.ok(getSoloInteractionDenial({ userId: 'operator-1', guildId: 'guild-1', commandName: name }));
  }
  for (const name of ['setup', 'sync', 'bigboard', 'mockdraft', 'draftexport', 'awards']) assert.equal(commands.has(name), true);
  for (const command of commands.values()) command.data.toJSON();
  assert.deepEqual(commands.get('setup').data.toJSON().options || [], []);
  assert.deepEqual(commands.get('sync').data.toJSON().options[0].choices.map((choice) => choice.value), ['weekly', 'full-season']);
  assert.equal(commands.get('roster').data.toJSON().options[0].required, true);
  for (const id of ['trade_builder_add|user|asset', 'madden_sportsbook_card', 'madden_mockdraft_live|create|auto', 'lb_plan_upgrade', 'madden_game_complete_button', 'scout_select_1']) {
    assert.equal(handlers.some((handler) => handler.customId instanceof RegExp ? handler.customId.test(id) : handler.customId === id), false, id);
  }
  // Check the retained app graph, including wrappers and literal dynamic imports.
  const visited = new Set();
  function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /from ['"][^'"]*(?:claim_service|manual_billing|upgrade_ux|league_recognition|sportsbook|access\.js)/);
    for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"]([.][^'"]+)['"]/g)) {
      const imported = path.resolve(path.dirname(file), match[1]);
      assert.ok(fs.existsSync(imported), `Missing import: ${file} -> ${imported}`);
      if (imported.endsWith('.js')) visit(imported);
    }
  }
  visit(path.resolve('src/app.js'));
  for (const name of ['standings_pin', 'playoff_picture', 'stat_leaders', 'power_rankings', 'transactions', 'injuries', 'player_changes']) visit(path.resolve(`src/madden/${name}.js`));
  console.log(`PASS permanent solo authorization, ${commands.size} command modules, ${handlers.length} handlers, and import integrity`);
} finally { process.env = original; }
