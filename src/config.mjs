import { resolve } from 'node:path';
export function configFrom(env = process.env, requireSecrets = true) {
  const number = (key, fallback, min, max, integer = true) => {
    const v = env[key] === undefined || env[key] === '' ? fallback : Number(env[key]);
    if (!Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) throw Error(`설정 오류: ${key}`);
    return v;
  };
  const ids = key => {
    const list = String(env[key] || '').split(',').map(x => x.trim()).filter(Boolean);
    if (list.some(x => !/^\d{15,22}$/.test(x))) throw Error(`설정 오류: ${key}`);
    return [...new Set(list)];
  };
  const c = {
    aiProvider: env.AI_PROVIDER || 'openai',
    token: env.DISCORD_BOT_TOKEN || '', guildIds: ids('DISCORD_ALLOWED_GUILD_IDS'), lobbyIds: ids('DISCORD_LOBBY_CHANNEL_IDS'),
    alertChannel: env.DISCORD_ALERT_CHANNEL_ID || '', aiKey: env.OPENAI_API_KEY || '', model: env.OPENAI_MODEL || '',
    dailyBudget: number('OPENAI_DAILY_BUDGET_USD', 1, 0, 100, false),
    inputRate: number('OPENAI_INPUT_USD_PER_MILLION', 0, 0, 1000, false), outputRate: number('OPENAI_OUTPUT_USD_PER_MILLION', 0, 0, 1000, false),
    codexBin: env.CODEX_BIN || 'codex', codexHome: env.CODEX_HOME || '', codexModel: env.CODEX_MODEL || '',
    codexTimeoutMs: number('CODEX_TIMEOUT_SECONDS', 90, 10, 180) * 1000,
    codexDailyLimit: number('CODEX_DAILY_REQUEST_LIMIT', 100, 0, 1000),
    databaseFile: resolve(env.DATABASE_FILE || 'data/trpg.sqlite'),
    explorationSeconds: number('EXPLORATION_WINDOW_SECONDS', 45, 5, 600), consensusSeconds: number('CONSENSUS_WINDOW_SECONDS', 30, 5, 300),
    combatSeconds: number('COMBAT_TURN_SECONDS', 90, 10, 600), minPartySize: number('MIN_PARTY_SIZE', 2, 2, 6), maxPartySize: number('MAX_PARTY_SIZE', 6, 2, 6),
    lobbyIdleMs: number('LOBBY_IDLE_HOURS', 24, 1, 720) * 60 * 60 * 1000,
    maxActiveSessions: number('MAX_ACTIVE_SESSIONS', 10, 1, 50), maxInputChars: number('MAX_INPUT_CHARS', 1000, 50, 2000),
    backupDays: number('BACKUP_RETENTION_DAYS', 14, 1, 90), retentionDays: number('DATA_RETENTION_DAYS', 365, 1, 730),
    maxOutputTokens: 4000, aiTimeoutMs: 45000, maxContextChars: 32000
  };
  if (!['openai', 'codex'].includes(c.aiProvider)) throw Error('설정 오류: AI_PROVIDER');
  if (c.minPartySize > c.maxPartySize) throw Error('최소 인원은 최대 인원 이하여야 합니다.');
  if (c.alertChannel && !/^\d{15,22}$/.test(c.alertChannel)) throw Error('설정 오류: DISCORD_ALERT_CHANNEL_ID');
  if (requireSecrets && (!c.token || !c.guildIds.length || !c.lobbyIds.length)) throw Error('.env의 전용 봇 토큰과 서버/로비 ID를 설정하세요.');
  if (requireSecrets && c.aiProvider === 'openai' && (!c.aiKey || !c.model || !c.inputRate || !c.outputRate)) throw Error('.env의 API 키, 모델과 단가를 설정하세요.');
  return c;
}
