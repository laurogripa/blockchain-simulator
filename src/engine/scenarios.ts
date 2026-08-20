// Scenario triggers are thin: they flip engine flags/fields that engine.ts's loop already
// respects (gated announcements, partition cut, hashrate boosts). See engine.ts for the wiring.
export type ScenarioKind = 'accidentalFork' | 'partition' | 'heal' | 'doubleSpend';
