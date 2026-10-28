// The UTC cases are deterministic; omitted timeZone uses the same host
// default in both Node and native and exercises construction-time capture.
const fields = { year: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', day: '2-digit', month: '2-digit' };
const utc = new Intl.DateTimeFormat('en-US', { ...fields, timeZone: 'UTC' });
const defaults = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' });
const military = new Intl.DateTimeFormat('en-US', { ...fields, timeZone: 'UTC', hour12: false });
const local = new Intl.DateTimeFormat(undefined, fields);
const leap = Date.UTC(2024, 1, 29, 23, 4, 5);
console.log(defaults.format(0), defaults.format(leap));
console.log(utc.format(0), utc.format(leap));
console.log(military.format(0), military.format(leap));
console.log(local.format(0), local.format(leap));
const previousZone = process.env.TZ;
process.env.TZ = 'UTC';
const capturedZone = new Intl.DateTimeFormat('en-US');
process.env.TZ = 'America/New_York';
console.log(capturedZone.format(0));
if (previousZone === undefined) delete process.env.TZ;
else process.env.TZ = previousZone;
const locales = ['en-US'];
const arrayLocale = new Intl.DateTimeFormat(locales, { timeZone: 'UTC' });
console.log(arrayLocale.format(0));
console.log(new Intl.DateTimeFormat(Array(1), { timeZone: 'UTC' }).format(0));
console.log(new Intl.DateTimeFormat(['en-US', 'en-US'], { timeZone: 'UTC' }).format(0));
try { new Intl.DateTimeFormat([undefined], { timeZone: 'UTC' }); } catch (error) { console.log(error.name); }
const format = utc.format;
console.log(format === utc.format, format.length, format.name);
console.log(format(0), format.call(null, 0));
const calls = [];
console.log(format({ valueOf() { calls.push('valueOf'); return 0; } }), calls.join(','));
console.log(format(null), format('0'), format(new Date(0)));
for (const value of [NaN, Infinity, -Infinity, 8640000000000001]) {
  try { format(value); } catch (error) { console.log(error.name, error.message); }
}
for (const options of [null, { year: 'invalid' }]) {
  try { new Intl.DateTimeFormat('en-US', options); } catch (error) { console.log(error.name); }
}
