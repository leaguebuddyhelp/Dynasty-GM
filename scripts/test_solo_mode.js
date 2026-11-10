#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  getSoloInteractionDenial,
  isSoloCommandEnabled,
  validateSoloModeConfig,
} from '../src/leaguebuddy/solo_mode.js';

const originalEnv = {
  mode: process.env.MADDEN_SOLO_MODE,
  userId: process.env.MADDEN_SOLO_USER_ID,
  guildId: process.env.MADDEN_SOLO_GUILD_ID,
};

try {
  process.env.MADDEN_SOLO_MODE = 'true';
  delete process.env.MADDEN_SOLO_USER_ID;
  delete process.env.MADDEN_SOLO_GUILD_ID;
  assert.throws(() => validateSoloModeConfig(), /MADDEN_SOLO_USER_ID and MADDEN_SOLO_GUILD_ID/);

  process.env.MADDEN_SOLO_USER_ID = 'operator-1';
  process.env.MADDEN_SOLO_GUILD_ID = 'guild-1';
  assert.equal(validateSoloModeConfig().enabled, true);
  assert.equal(getSoloInteractionDenial({ userId: 'other', guildId: 'guild-1' })?.includes('authorized operator'), true);
  assert.equal(getSoloInteractionDenial({ userId: 'operator-1', guildId: 'guild-2' })?.includes('different'), true);
  assert.equal(getSoloInteractionDenial({ userId: 'operator-1', guildId: 'guild-1' }), null);
  assert.equal(getSoloInteractionDenial({
    userId: 'operator-1',
    guildId: 'guild-1',
    commandName: 'tradeblock',
  })?.includes('disabled'), true);
  assert.equal(getSoloInteractionDenial({
    userId: 'operator-1',
    guildId: 'guild-1',
    customId: 'trade_builder_add|user|asset',
  })?.includes('disabled'), true);
  assert.equal(isSoloCommandEnabled('sync'), true);
  assert.equal(isSoloCommandEnabled('scout'), false);

  console.log('PASS solo mode config and authorization checks');
} finally {
  if (originalEnv.mode === undefined) delete process.env.MADDEN_SOLO_MODE;
  else process.env.MADDEN_SOLO_MODE = originalEnv.mode;
  if (originalEnv.userId === undefined) delete process.env.MADDEN_SOLO_USER_ID;
  else process.env.MADDEN_SOLO_USER_ID = originalEnv.userId;
  if (originalEnv.guildId === undefined) delete process.env.MADDEN_SOLO_GUILD_ID;
  else process.env.MADDEN_SOLO_GUILD_ID = originalEnv.guildId;
}
