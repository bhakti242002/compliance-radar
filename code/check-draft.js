// Check the draft: a tripwire for invented facts. Code node, Mode: Run Once for All Items.
const alert = $('Alert in').first().json;
const out = $input.first().json;

// The model node's output shape differs by node and version: take the first text found.
const draft = String(
  out.content?.find?.(c => c.type === 'text')?.text ?? out.text ?? out.output ?? out.message?.content ?? ''
).trim();

// Every number in the draft must already appear in the rule or the facts.
const numbersIn = s => (String(s).match(/\d[\d,.]*/g) || [])
  .map(n => n.replace(/[.,]+$/, '').replace(/,/g, ''))
  .map(n => String(Number(n))); // "05" and "5" compare equal
const allowed = new Set(numbersIn(
  [alert.title, alert.requirement, alert.source_name, alert.source_url, JSON.stringify(alert.facts)].join(' ')
));
const unexpected = [...new Set(numbersIn(draft))].filter(n => !allowed.has(n));

const problems = [];
if (!alert.requirement || !alert.source_url) problems.push('The alert arrived without its rule details, so there was nothing to draft from.');
if (!draft) problems.push('The model returned no text.');
if (unexpected.length) problems.push(`Numbers that aren't in the rule or facts: ${unexpected.join(', ')}.`);
if (alert.source_url && !draft.includes(alert.source_url)) problems.push('The source link is missing.');

return [{ json: { draft, passed: problems.length === 0, problems: problems.join(' ') } }];
