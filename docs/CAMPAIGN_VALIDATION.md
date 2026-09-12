# Campaign generation validation — 2026-09-12

## Problem and scope

The previous opening generator selected canned strings using correlated indexes. Korean openings had only three combinations per genre. It did not call the AI and ran before the party created its characters. The new start flow generates the world after preparation and persists the request/result for recovery.

## Automated evidence

- 92 offline tests passed, including generation failure, duplicate start, pause/resume while generation is in flight, ending during generation, persisted result recovery, existing lobby compatibility, first-action context, and Codex quota/no paid fallback.
- Configuration/SQLite check, JavaScript syntax checks, diff whitespace check, and public-release check passed.
- CI now supplies dummy configuration for its offline configuration check; it does not require production secrets.

## Actual AI evidence

`npm run check-campaigns` ran with the configured Codex provider, isolated sessions and no Discord messages. Each run used three campaign requests plus interpretation/narration for one action.

An initial run produced two mystery openings that both involved an auction, despite changing locations. This was treated as insufficient variety. Generation was then given a different initial situation category from recent starts and explicit instructions to avoid repeating the central activity.

The revised run produced:

| Case | Prepared character | Generated situation |
| --- | --- | --- |
| Korean mystery 1 | Retired stage magician; prop appraisal; debt | An earthquake-damaged theater, a trapped strongbox and conflicting offers during evacuation |
| Korean mystery 2, same character | Same role, specialty and weakness | A lantern festival, a threat delivered through a paper prop and a public-event dilemma |
| English cyberpunk | Rooftop gardener; seed restoration; corporate debt | A rooftop growing competition, patent pressure and sabotaged cooling beds |

The first character declined the initial offer and sought paid appraisal work. The resulting scene preserved the generated setting and narrated the failed negotiation from the engine's actual dice check.

## Limits

These samples establish that real generation and first-action continuation work; they do not prove unlimited novelty or long-campaign quality. NPC motifs can recur. Only exact repeated openings or location/premise pairs are rejected mechanically. Offline fixtures are explicitly separate from live AI checks. Real Discord clicks for these new test sessions were not performed; the deployment health check covers Gateway/DB readiness, and existing session openings are compared before and after deployment.

Structured output follows the official [OpenAI Structured Outputs schema contract](https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas). Priorities beyond this change are recorded in the [roadmap](ROADMAP.md).
