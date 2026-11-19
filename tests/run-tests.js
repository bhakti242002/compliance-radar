// Runs the radar's code against the starter data, the way n8n would. Usage: node tests/run-tests.js
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const data = JSON.parse(read('tests/starter-data.json'));
const evaluateCode = read('code/evaluate-rules.js');
const checkCode = read('code/check-draft.js');

function evaluate(sheets, today) {
  const nodes = {
    'Read employees': sheets.employees,
    'Read rules': sheets.rules,
    'Read registered states': sheets.registered_states,
    'Read alerts log': sheets.alerts_log.length ? sheets.alerts_log : [{}], // "Always Output Data" on an empty tab
  };
  const $ = name => ({ all: () => nodes[name].map(json => ({ json })) });
  return new Function('$', '$now', evaluateCode)($, { toFormat: () => today }).map(i => i.json.alert_key).sort();
}
function check(alert, text) {
  const $ = () => ({ first: () => ({ json: alert }) });
  const $input = { first: () => ({ json: { content: [{ type: 'text', text }] } }) };
  return new Function('$', '$input', checkCode)($, $input)[0].json;
}

let failed = 0;
function expect(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`}`);
}

// 1. First run on the starter data
const firstRun = evaluate(data, '2026-11-19');
expect('first run finds the four expected alerts', firstRun,
  ['CA_HARASSMENT_DEADLINE:2027-01-01', 'COBRA_NEXT_YEAR:2027', 'NEW_STATE_PAYROLL:NY', 'NY_DBL_PFL:NY']);

// 2. Second run: those four are logged, and a Washington hire starts on 2026-12-07
const later = JSON.parse(JSON.stringify(data));
firstRun.forEach(alert_key => later.alerts_log.push({ alert_key, status: 'sent' }));
later.employees.push({ employee_id: 'E24', work_state: 'WA', type: 'employee', start_date: '2026-12-07', end_date: '', weekly_hours: 40 });
expect('a second run only flags the new Washington hire', evaluate(later, '2026-11-19'), ['NEW_STATE_PAYROLL:WA']);

// 3. A new year: last year's count now makes federal COBRA apply, and the passed deadline goes quiet
const newYear = evaluate(data, '2027-01-05');
expect('in 2027, COBRA_FEDERAL fires and the passed deadline does not',
  [newYear.includes('COBRA_FEDERAL:2027'), newYear.includes('CA_HARASSMENT_DEADLINE:2027-01-01')], [true, false]);

// 4. The draft fact check
const alert = {
  title: 'New York disability and Paid Family Leave coverage',
  requirement: 'An employer with one or more employees working in New York on each of at least 30 days in a calendar year must carry coverage starting four weeks after the 30th day of employment.',
  source_url: 'https://www.wcb.ny.gov/content/main/coverage-required-db.jsp',
  facts: { state: 'NY', employees_in_state: 1, first_start_date: '2026-10-05' },
};
const link = '\n' + alert.source_url;
expect('a grounded draft passes', check(alert, 'Your New York hire started October 5, 2026. Spine will set up coverage.' + link).passed, true);
expect('an invented date and fine are flagged',
  check(alert, 'Coverage is due by December 11, and fines can reach $2,000.' + link).problems.includes('11, 2000'), true);
expect('a draft without its source link is flagged', check(alert, 'Heads up about New York coverage.').passed, false);
expect('an alert with no rule details is flagged', check({}, 'All the fields are blank.').passed, false);

console.log(failed ? `\n${failed} test(s) failed` : '\nAll tests passed');
process.exit(failed ? 1 : 0);
