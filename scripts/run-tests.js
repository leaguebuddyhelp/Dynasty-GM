import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scripts = [
  'test_report_navigation.js',
  'test_weekly_gameplay_progression.js',
  'test_rookie_pipeline.js',
  'test_progression_rating_tiers.js',
  'test_ea_session.js',
  'test_application_emojis.js',
  'test_solo_mode.js', 'test_solo_setup.js', 'test_madden_sync_history.js',
  'test_madden_progression.js', 'test_inactivity_progression.js', 'test_season_overall_changes.js', 'test_dynamic_ratings.js', 'test_weekly_awards.js', 'test_top100_boards.js', 'test_draft_class_files.js', 'test_weekly_mock_draft.js', 'test_draft_export.js', 'test_solo_reports.js', 'test_draft_grades_gate.js',
];
for (const script of scripts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leaguebuddy-test-'));
  try {
    const result = spawnSync(process.execPath, [path.join('scripts', script)], {
      stdio: 'inherit',
      env: { ...process.env, LB_DATA_ROOT: root, MADDEN_SOLO_USER_ID: 'operator-1', MADDEN_SOLO_GUILD_ID: 'guild-1' },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) { process.exitCode = result.status || 1; break; }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
