// These are native refusal contracts, not Node parity cases: Node implements
// the ICU-backed forms that this intentionally limited formatter refuses.
function refuses(label, action) {
  try { action(); console.log(label, false); }
  catch (error) { console.log(label, error.code === 'SC2020'); }
}
refuses('locale', () => new Intl.DateTimeFormat('fr-FR'));
refuses('month', () => new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
refuses('calendar', () => new Intl.DateTimeFormat('en-US', { calendar: 'buddhist' }));
refuses('numbering', () => new Intl.DateTimeFormat('en-US', { numberingSystem: 'arab' }));
refuses('zone', () => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York' }));
refuses('profile', () => new Intl.DateTimeFormat('en-US', { year: 'numeric' }));
refuses('weekday', () => new Intl.DateTimeFormat('en-US', { weekday: 'long' }));
refuses('style', () => new Intl.DateTimeFormat('en-US', { dateStyle: 'full' }));
refuses('parts', () => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).formatToParts(0));
refuses('primitive', () => new Intl.DateTimeFormat('en-US', 1));
