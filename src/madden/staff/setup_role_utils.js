import { applyTeamEmojiRoleIcon } from '../../shared/role_icon_utils.js';

export const DEFAULT_ROLE_SPECS = [
  { key: 'LB Commish', name: 'LB Commish', color: 0x5865F2, hoist: true },
  { key: 'LB Co-Commish', name: 'LB Co-Commish', color: 0x57F287, hoist: true },
  { key: 'LEAGUEbuddy Coaches', name: 'LEAGUEbuddy Coaches', color: 0xFEE75C, hoist: false, mentionable: true },
];

export const TRADE_ROLE_SPECS = [
  { key: 'Trade Committee', name: 'LEAGUEbuddy Trade Committee', color: 0xFEE75C, hoist: true },
];

export const ROLE_CREATE_TIMEOUT_MS = 10000;
export const ROLE_CREATE_RETRIES = 1;
export const ROLE_CREATE_BACKOFF_MS = 1000;
export const ROLE_CREATE_SPACING_MS = 250;

const ACTIVE_ROLE_SYNC = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

export function buildCoachRoleSpecs(snapshot) {
  const teams = snapshot?.teams?.leagueTeamInfoList || [];
  return teams
    .map((team) => {
      const city = String(team?.cityName || '').trim();
      const display = String(team?.displayName || '').trim();
      const nick = String(team?.nickName || '').trim();
      const abbr = String(team?.abbrName || '').trim().toLowerCase();
      const fullName = [city, display].filter(Boolean).join(' ').trim() || display || nick;
      if (!fullName) return null;
      return {
        teamId: String(team?.teamId ?? fullName),
        teamName: fullName,
        emojiName: abbr,
        roleName: `${fullName} Coach`,
        aliases: uniqueStrings([
          `${fullName} Coach`,
          display ? `${display} Coach` : '',
          nick ? `${nick} Coach` : '',
        ]),
      };
    })
    .filter(Boolean);
}

function describeDiscordError(error) {
  const message = error?.message || String(error);
  const status = error?.status || error?.rawError?.status || null;
  const code = error?.code || error?.rawError?.code || null;
  const looksRateLimited = status === 429 || code === 429 || /rate.?limit/i.test(message);
  const isTimeout = /timed out after/i.test(message);
  return {
    message,
    status,
    code,
    looksRateLimited,
    isTimeout,
    summary: looksRateLimited
      ? `${message} (Discord rate limit detected)`
      : isTimeout
        ? `${message} (Discord did not return in time; no explicit 429 was received)`
        : message,
  };
}

async function withTimeout(promise, ms, label) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function findRoleByName(guild, roleName, { fresh = false } = {}) {
  if (fresh) {
    await guild.roles.fetch().catch(() => null);
  }
  return guild.roles.cache.find((role) => role.name === roleName) || null;
}

async function createRoleOnce(guild, spec) {
  const existing = await findRoleByName(guild, spec.name, { fresh: true });
  if (existing) {
    return { role: existing, source: 'existing' };
  }

  const role = await guild.roles.create({
    name: spec.name,
    mentionable: spec.mentionable === true,
    hoist: spec.hoist === true,
    color: spec.color ?? undefined,
    reason: 'Madden v2 setup',
  });
  return { role, source: 'create_response' };
}

async function maybeApplyRoleIcon(role, spec, logger) {
  const teamName = spec?.teamName || String(spec?.name || '').replace(/ coach$/i, '').trim();
  if (!/ coach$/i.test(String(spec?.name || '')) || !teamName) return;
  await applyTeamEmojiRoleIcon(role, teamName, { emojiName: spec?.emojiName, logger });
}

export async function createOrVerifyRole(guild, spec, {
  timeoutMs = ROLE_CREATE_TIMEOUT_MS,
  retries = ROLE_CREATE_RETRIES,
  backoffMs = ROLE_CREATE_BACKOFF_MS,
  logger = console,
} = {}) {
  const startedAt = Date.now();
  const existing = await findRoleByName(guild, spec.name, { fresh: true });
  if (existing) {
    await maybeApplyRoleIcon(existing, spec, logger);
    logger.log('[setup-role] already existed', {
      guildId: guild.id,
      role: spec.name,
      source: 'fresh_fetch',
      elapsedMs: Date.now() - startedAt,
    });
    return { ok: true, role: existing, outcome: 'already_exists', attempts: 0, elapsedMs: Date.now() - startedAt };
  }

  let lastError = null;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const attemptStarted = Date.now();
    try {
      logger.log('[setup-role] creating', { guildId: guild.id, role: spec.name, attempt });
      const result = await withTimeout(
        createRoleOnce(guild, spec),
        timeoutMs,
        `role create: ${spec.name}`,
      );
      logger.log('[setup-role] created immediately', {
        guildId: guild.id,
        role: spec.name,
        attempt,
        source: result.source,
        elapsedMs: Date.now() - attemptStarted,
      });
      await maybeApplyRoleIcon(result.role, spec, logger);
      await sleep(ROLE_CREATE_SPACING_MS);
      return {
        ok: true,
        role: result.role,
        outcome: result.source === 'existing' ? 'already_exists' : 'created_immediately',
        attempts: attempt,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (error) {
      const described = describeDiscordError(error);
      lastError = described;
      logger.warn('[setup-role] create attempt failed', {
        guildId: guild.id,
        role: spec.name,
        attempt,
        status: described.status,
        code: described.code,
        message: described.summary,
        elapsedMs: Date.now() - attemptStarted,
      });

      const verified = await findRoleByName(guild, spec.name, { fresh: true });
      if (verified) {
        await maybeApplyRoleIcon(verified, spec, logger);
        logger.log('[setup-role] verified after timeout/failure', {
          guildId: guild.id,
          role: spec.name,
          attempt,
          elapsedMs: Date.now() - startedAt,
        });
        return {
          ok: true,
          role: verified,
          outcome: 'verified_after_timeout',
          attempts: attempt,
          elapsedMs: Date.now() - startedAt,
        };
      }

      logger.warn('[setup-role] still missing after fresh fetch', {
        guildId: guild.id,
        role: spec.name,
        attempt,
        elapsedMs: Date.now() - attemptStarted,
      });

      if (attempt <= retries) {
        await sleep(backoffMs);
      }
    }
  }

  return {
    ok: false,
    role: null,
    outcome: 'failed_after_retries',
    attempts: retries + 1,
    elapsedMs: Date.now() - startedAt,
    error: lastError?.summary || 'Unknown role create failure',
    status: lastError?.status || null,
    code: lastError?.code || null,
  };
}

export async function syncRoleSpecs(guild, specs, {
  logger = console,
  ...options
} = {}) {
  const previous = ACTIVE_ROLE_SYNC.get(guild.id);
  if (previous) {
    logger.warn('[setup-role] waiting for previous guild role sync', { guildId: guild.id });
    await previous.catch(() => null);
  }

  const run = (async () => {
  const summary = {
    created: [],
    existing: [],
    verified: [],
    failed: [],
  };

  for (const spec of specs) {
    const result = await createOrVerifyRole(guild, spec, { logger, ...options });
    if (!result.ok) {
      summary.failed.push({
        name: spec.name,
        error: result.error,
        attempts: result.attempts,
        status: result.status,
        code: result.code,
      });
      continue;
    }

    if (result.outcome === 'already_exists') {
      summary.existing.push({ name: spec.name, roleId: result.role.id });
    } else if (result.outcome === 'verified_after_timeout') {
      summary.verified.push({ name: spec.name, roleId: result.role.id });
    } else {
      summary.created.push({ name: spec.name, roleId: result.role.id });
    }
  }

  return summary;
  })();

  ACTIVE_ROLE_SYNC.set(guild.id, run);
  try {
    return await run;
  } finally {
    if (ACTIVE_ROLE_SYNC.get(guild.id) === run) {
      ACTIVE_ROLE_SYNC.delete(guild.id);
    }
  }
}
