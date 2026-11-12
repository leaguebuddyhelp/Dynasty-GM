import assert from 'node:assert/strict';
import { EmbedBuilder } from 'discord.js';
import { buildTeamReportIndex, appendProgressionResultFields } from '../src/madden/report_navigation.js';

const reports = Array.from({ length: 32 }, (_, index) => ({
  teamName: `A Long NFL Team Name ${index}`, url: `https://discord.com/channels/1516463916933189742/1570155550984110181/1570517022415126549`,
}));
const index = buildTeamReportIndex({ title: 'Season 2026 · Top 10 Growers / Fallers', description: 'Actual season OVR movement.', reports }).toJSON();
assert.equal(index.fields.flatMap((field) => field.value.split('\n')).length, 32);
assert.ok(index.fields.every((field) => field.value.length <= 1024));
assert.ok(JSON.stringify(index).length < 6000);
const receipt = appendProgressionResultFields(new EmbedBuilder().setTitle('Madden Data Import'), {
  published: true, periodKey: 'year_2026_week_18', recommendationCount: 30, upgradeCount: 18, downgradeCount: 12,
  reportUrl: reports[0].url, seasonChanges: { teamCount: 32, indexUrl: reports[1].url },
}).toJSON();
assert.match(receipt.fields[0].name, /Week 18/);
assert.match(receipt.fields[0].value, /30 player changes.*18 upgrades.*12 downgrades/s);
assert.match(receipt.fields[0].value, /Open weekly changes/);
assert.match(receipt.fields[1].value, /32 teams/);
assert.match(receipt.fields[1].value, /Open all team lists/);
const failed = appendProgressionResultFields(new EmbedBuilder().setTitle('Import'), {
  error: 'Discord unavailable', seasonChangesError: 'Missing permission',
}).toJSON();
assert.match(failed.fields[0].value, /Failed: Discord unavailable/);
assert.match(failed.fields[1].value, /Failed: Missing permission/);
console.log('PASS 32-team navigation, Discord embed limits, visible 30-player results, report links, and failure reporting');
