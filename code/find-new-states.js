// Find new-state hiring from public Ashby job boards. Code node, Mode: Run Once for All Items.
const STATES = { alabama:'AL', alaska:'AK', arizona:'AZ', arkansas:'AR', california:'CA', colorado:'CO',
  connecticut:'CT', delaware:'DE', 'district of columbia':'DC', florida:'FL', georgia:'GA', hawaii:'HI',
  idaho:'ID', illinois:'IL', indiana:'IN', iowa:'IA', kansas:'KS', kentucky:'KY', louisiana:'LA', maine:'ME',
  maryland:'MD', massachusetts:'MA', michigan:'MI', minnesota:'MN', mississippi:'MS', missouri:'MO',
  montana:'MT', nebraska:'NE', nevada:'NV', 'new hampshire':'NH', 'new jersey':'NJ', 'new mexico':'NM',
  'new york':'NY', 'north carolina':'NC', 'north dakota':'ND', ohio:'OH', oklahoma:'OK', oregon:'OR',
  pennsylvania:'PA', 'rhode island':'RI', 'south carolina':'SC', 'south dakota':'SD', tennessee:'TN',
  texas:'TX', utah:'UT', vermont:'VT', virginia:'VA', washington:'WA', 'west virginia':'WV',
  wisconsin:'WI', wyoming:'WY' };
const CODES = new Set(Object.values(STATES));
const US = new Set(['', 'us', 'usa', 'united states', 'united states of america']);

function stateOf(address, label) {
  const region = String(address?.addressRegion || '').trim();
  const country = String(address?.addressCountry || '').trim().toLowerCase();
  if (region && US.has(country)) {
    if (CODES.has(region.toUpperCase())) return region.toUpperCase();
    if (STATES[region.toLowerCase()]) return STATES[region.toLowerCase()];
  }
  const m = String(label || '').match(/,\s*([A-Z]{2})\b/); // "Austin, TX"
  if (m && CODES.has(m[1])) return m[1];
  return null; // remote, non-US, or unparseable
}

const prospects = $('Read prospects').all().map(i => i.json);
const seen = new Set();
const baselined = new Set();
for (const r of $('Read prospect log').all().map(i => i.json)) {
  if (!r.signal_key) continue;
  seen.add(String(r.signal_key));
  baselined.add(String(r.company));
}
const rule = $('Read rules').all().map(i => i.json).find(r => r.rule_id === 'NEW_STATE_PAYROLL');
const today = $now.toFormat('yyyy-MM-dd');

const out = [];
$('Get Ashby jobs').all().forEach((item, i) => { // one response per prospect, in the same order
  const prospect = prospects[i];
  const jobs = item.json.jobs;
  if (!prospect || !Array.isArray(jobs)) return; // a bad board name or failed request: skip it
  const firstJobPerState = new Map();
  for (const job of jobs) {
    if (job.isListed === false) continue;
    const places = [{ address: job.address?.postalAddress, label: job.location },
      ...(job.secondaryLocations || []).map(s => ({ address: s.address, label: s.location }))];
    for (const p of places) {
      const st = stateOf(p.address, p.label);
      if (st && !firstJobPerState.has(st)) firstJobPerState.set(st, job);
    }
  }
  for (const [state, job] of firstJobPerState) {
    const signal_key = `${prospect.company}:${state}`;
    if (seen.has(signal_key)) continue;
    out.push({ json: {
      signal_key, company: prospect.company, state, first_seen: today,
      job_title: job.title, job_url: job.jobUrl,
      // the first run for a company only records a baseline, so you aren't flooded on day one
      status: baselined.has(prospect.company) ? 'new' : 'baseline',
      rule_title: rule?.title, rule_requirement: rule?.requirement, source_url: rule?.source_url,
    }});
  }
});
return out;
