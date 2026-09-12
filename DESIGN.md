# Design

## Source of truth
- Status: implemented contract, 2026-09-11.
- Surfaces: Discord lobby, slash commands, game messages and private interaction replies.
- Evidence: users entered `1` into the unexplained `role` field and needed external help to begin.

## Brand
Friendly Korean game host for a small group of friends.

## Product goals
Players can choose a character and start through buttons without consulting a separate assistant.

## Personas and jobs
First-time TRPG players want to join friends, pick a recognizable job and learn the next action as they play.

## Information architecture
Lobby channel → game thread → choose job → ready → host starts → choose or type actions.

## Design principles
Explain the current step beside its controls. Prefer constrained choices to unexplained free text. Preserve ongoing games and old commands.

## Visual language
Discord-native messages and buttons. Brief Korean labels; readiness uses both text and a check mark.

## Components
Three job buttons automatically join. Names default to Discord nicknames. A participant list shows who needs to choose or ready. Start stays disabled until eligible. Help is always available.

## Accessibility
No color-only meanings. Describe each job. Use Korean slash option names and choices; no numeric job codes.

## Responsive behavior
Discord controls wrap into rows of at most five buttons. Keep content within message limits for desktop and mobile.

## Interaction states
Lobby shows steps and readiness; exploration gives an example; combat explains buttons; voting requests a choice; resolving asks players to wait; paused offers resume. Old buttons return current controls without acting.

## Content voice
Short, friendly Korean with a concrete next action. Avoid internal state names and setup terminology during play.

## Implementation constraints
No dependencies. Persisted games survive deployment. Existing host permissions, phase guards and end confirmation remain enforced. AI authentication is separate from character setup.

## Open questions
None blocking this onboarding improvement.
