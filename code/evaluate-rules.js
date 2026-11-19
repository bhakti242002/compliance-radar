// Evaluate rules: decides which rules newly apply. Counting only, no AI.
// Code node, Mode: Run Once for All Items. Node names below must match your canvas.

const CONFIG = {
  FULL_TIME_HOURS: 40, // the employer's own full-time definition (COBRA counts part-timers as a fraction of it)
  LOOKAHEAD_DAYS: 45,  // flag a new-state hire this many days before their start date
};

// ---------- read the sheets ----------
const rows = name => $(name).all().map(i => i.json).filter(r => Object.keys(r).length > 0);
const employees = rows('Read employees');
const rules = rows('Read rules').filter(r => String(r.active).toUpperCase() === 'TRUE');
const registered = new Set(rows('Read registered states').map(r => String(r.state).trim().toUpperCase()));
const alreadyLogged = new Set(rows('Read alerts log').map(r => String(r.alert_key).trim()));

// ---------- dates (date-only, in UTC so time zones can't shift a day) ----------
const DAY = 86400000;
function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + v * DAY); // Sheets serial number
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // a reformatted US-style cell
  if (m) return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  throw new Error(`Can't read the date "${s}". Use YYYY-MM-DD.`);
}
const iso = d => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const todayText = $now.toFormat('yyyy-MM-dd'); // $now follows the workflow's time zone
const today = parseDate(todayText);
const thisYear = today.getUTCFullYear();

const people = employees.map(e => ({
  state: String(e.work_state || '').trim().toUpperCase(),
  isContractor: String(e.type || '').trim().toLowerCase() === 'contractor',
  start: parseDate(e.start_date),
  end: parseDate(e.end_date),
  hours: Number(e.weekly_hours) || 0,
}));
const activeOn = (p, d) => p.start && p.start <= d && (!p.end || p.end >= d);
const startsSoon = p => p.start && p.start > today && p.start <= addDays(today, CONFIG.LOOKAHEAD_DAYS);

// ---------- counting helpers ----------
function businessDays(year, upTo) { // weekdays stand in for "typical business days"
  const last = upTo && upTo.getUTCFullYear() === year ? upTo : new Date(Date.UTC(year, 11, 31));
  const days = [];
  for (let d = new Date(Date.UTC(year, 0, 1)); d <= last; d = addDays(d, 1)) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) days.push(d);
  }
  return days;
}
function cobraCount(d) { // full-time counts as 1, part-time as hours / full-time hours
  return people.filter(p => !p.isContractor && activeOn(p, d))
    .reduce((sum, p) => sum + Math.min(1, p.hours / CONFIG.FULL_TIME_HOURS), 0);
}
const daysAtOrAbove = (year, threshold, upTo) =>
  businessDays(year, upTo).filter(d => cobraCount(d) >= threshold).length;

function aleMonth(year, month) { // IRS: full-time (130+ hours) + part-time hours / 120, max 120 each
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  let fullTime = 0, partTimeHours = 0;
  for (const p of people) {
    if (p.isContractor) continue;
    let activeDays = 0;
    for (let d = first; d <= last; d = addDays(d, 1)) if (activeOn(p, d)) activeDays++;
    if (!activeDays) continue;
    const hours = (p.hours * 52 / 12) * (activeDays / last.getUTCDate());
    if (hours >= 130) fullTime++;
    else partTimeHours += Math.min(hours, 120);
  }
  return fullTime + partTimeHours / 120;
}
function aleAverage(year, months) {
  let total = 0;
  for (let m = 0; m < months; m++) total += aleMonth(year, m);
  return Math.floor(total / months); // the IRS rounds a fractional average down
}
const headcount = withContractors =>
  people.filter(p => activeOn(p, today) && (withContractors || !p.isContractor)).length;
const employeesIn = st =>
  people.filter(p => !p.isContractor && p.state === st && (activeOn(p, today) || startsSoon(p)));
const earliestStart = list => iso(list.map(p => p.start).sort((a, b) => a - b)[0]);

// ---------- evaluate each rule ----------
const alerts = [];
function fire(rule, scope, facts) {
  const alert_key = `${rule.rule_id}:${scope}`;
  if (alreadyLogged.has(alert_key)) return; // already flagged once: stay quiet
  alerts.push({ json: {
    alert_key, rule_id: rule.rule_id, scope, detected_on: todayText,
    title: rule.title, requirement: rule.requirement, owner: rule.owner,
    source_name: rule.source_name, source_url: rule.source_url, facts,
  }});
}

for (const rule of rules) {
  const threshold = Number(rule.threshold) || 0;
  const st = String(rule.state || '').trim().toUpperCase();
  const withContractors = String(rule.count_contractors).toUpperCase() === 'TRUE';
  const inRuleState = !st || people.some(p => p.state === st && activeOn(p, today) && (withContractors || !p.isContractor));

  switch (rule.check) {
    case 'new_state': { // a state with employees (or a hire starting soon) where payroll isn't registered
      const states = new Set(people.filter(p => !p.isContractor && (activeOn(p, today) || startsSoon(p))).map(p => p.state));
      for (const s of states) {
        if (registered.has(s) || (st && s !== st)) continue;
        const there = employeesIn(s);
        fire(rule, s, { state: s, employees_in_state: there.length, first_start_date: earliestStart(there) });
      }
      break;
    }
    case 'state_has_employees': {
      const there = employeesIn(st);
      if (there.length >= threshold)
        fire(rule, st, { state: st, employees_in_state: there.length, first_start_date: earliestStart(there) });
      break;
    }
    case 'headcount_gte': {
      const n = headcount(withContractors);
      if (n >= threshold && inRuleState)
        fire(rule, 'ALL', { headcount: n, counts_contractors: withContractors, threshold });
      break;
    }
    case 'upcoming_deadline': {
      const deadline = parseDate(rule.deadline_date);
      const daysLeft = Math.round((deadline - today) / DAY);
      const n = headcount(withContractors);
      if (n >= threshold && inRuleState && daysLeft >= 0 && daysLeft <= Number(rule.lead_days))
        fire(rule, iso(deadline), { deadline: iso(deadline), days_left: daysLeft, headcount: n });
      break;
    }
    case 'cobra_prior_year': {
      const y = thisYear - 1, total = businessDays(y).length, hit = daysAtOrAbove(y, threshold);
      if (hit > total / 2)
        fire(rule, String(thisYear), { counted_year: y, days_at_or_above: hit, business_days_in_year: total, threshold });
      break;
    }
    case 'cobra_current_year': { // already past half of this year's business days, so next year is locked in
      const total = businessDays(thisYear).length, hit = daysAtOrAbove(thisYear, threshold, today);
      if (hit > total / 2)
        fire(rule, String(thisYear + 1), { counted_year: thisYear, days_at_or_above_so_far: hit, business_days_in_year: total, threshold, applies_in_year: thisYear + 1 });
      break;
    }
    case 'ale_prior_year': {
      const avg = aleAverage(thisYear - 1, 12);
      if (avg >= threshold)
        fire(rule, String(thisYear), { counted_year: thisYear - 1, average_full_time_equivalents: avg, threshold });
      break;
    }
    case 'ale_current_ytd': {
      const months = today.getUTCMonth(); // completed months so far this year
      if (!months) break;
      const avg = aleAverage(thisYear, months);
      if (avg >= threshold)
        fire(rule, String(thisYear + 1), { counted_year: thisYear, months_counted: months, average_so_far: avg, threshold });
      break;
    }
    default:
      throw new Error(`Rule ${rule.rule_id} has an unknown check: "${rule.check}"`);
  }
}

return alerts;
