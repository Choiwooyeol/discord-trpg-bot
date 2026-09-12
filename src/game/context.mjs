export function buildContext(session, checks = []) {
  return { players: structuredClone(session.players ?? []), actions: structuredClone(session.actions ?? {}), world: structuredClone(session.world ?? {}), campaign: { genre: session.world?.genre, premise: session.world?.premise, objective: session.world?.objective, factions: session.world?.factions ?? [] }, summary: (session.summary ?? '').slice(0,3000), recent: (session.recent ?? []).slice(-6).map(s=>String(s).slice(0,600)), checks };
}
