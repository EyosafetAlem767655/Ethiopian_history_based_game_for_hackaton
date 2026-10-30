// Only trusted static server statements use this dialect adapter; values always stay parameters.
export function postgresSQL(sql: string) {
  let index = 0;
  let value = sql.replace(/\?/g, () => '$' + ++index);
  if (/INSERT OR IGNORE/i.test(value))
    value = value.replace(/INSERT OR IGNORE/i, 'INSERT') + ' ON CONFLICT DO NOTHING';
  if (/INSERT OR REPLACE/i.test(value)) {
    const table = value.match(/INTO\s+(\w+)/i)?.[1];
    const columns: Record<string, string[]> = {
      wallets: ['player_id', 'address'],
      wallet_nonces: ['player_id', 'nonce', 'expires'],
    };
    const names = columns[table ?? ''];
    if (!names) throw Error('Unsupported upsert');
    value =
      value.replace(/INSERT OR REPLACE/i, 'INSERT') +
      ` ON CONFLICT (${names[0]}) DO UPDATE SET ` +
      names
        .slice(1)
        .map((n) => `${n}=excluded.${n}`)
        .join(',');
  }
  const tables = new Set([
    'profiles',
    'secrets',
    'results',
    'participants',
    'badges',
    'outbox',
    'squads',
    'gatherings',
    'campaign_progress',
    'hosted_identities',
    'hosted_outbox',
    'gathering_sessions',
    'wallets',
    'wallet_nonces',
    'avatars',
    'age_reviews',
    'team_messages',
    'notifications',
    'friends',
    'tournaments',
    'revoked_sessions',
    'web3_jobs',
    'web3_challenges',
    'media_deletions',
  ]);
  // A transaction pooler does not guarantee session settings: never depend on search_path.
  value = value.replace(
    /\b(FROM|JOIN|INTO|UPDATE)\s+(\w+)\b/gi,
    (match, verb: string, table: string) =>
      tables.has(table.toLowerCase()) ? `${verb} game_runtime.${table}` : match,
  );
  return value.replace(/\bsafe_rating\(/g, 'game_runtime.safe_rating(');
}
