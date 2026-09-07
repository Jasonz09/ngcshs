(function (root) {
    'use strict';
    const grades = ['Freshman', 'Sophomore', 'Junior', 'Senior'];
    const clubYears = ['First Year', 'Second Year', 'Third Year', 'Fourth Year'];
    const schoolYear = date => { const [y, m] = date.split('-').map(Number); const start = m >= 8 ? y : y - 1; return `${start}-${start + 1}`; };
    const yearAt = (first, offset) => { const start = Number(first.slice(0, 4)) + offset; return `${start}-${start + 1}`; };
    const validYear = year => /^\d{4}-\d{4}$/.test(year) && Number(year.slice(5)) === Number(year.slice(0, 4)) + 1;
    function joinedYear(state, id, fallback) {
        const m = state.members[id];
        return m.joinedYear || [...Object.keys(m.years || {}), ...Object.values(state.entries || {}).filter(e => e.memberId === id).map(e => e.year)].filter(validYear).sort()[0] || fallback;
    }
    const clubYear = (state, id, year) => Number(year.slice(0, 4)) - Number(joinedYear(state, id, year).slice(0, 4)) + 1;
    const active = (state, id, year) => clubYear(state, id, year) >= 1 && clubYear(state, id, year) <= 4;
    const category = entry => entry.category || (entry.type === 'attendance' ? 'participation' : entry.type === 'manual' ? 'service' : 'unclassified');
    const normalize = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
    const key = value => Array.from(new TextEncoder().encode(value), b => b.toString(16).padStart(2, '0')).join('');
    const amount = value => {
        const number = Number(value);
        if (!String(value).trim() || !Number.isFinite(number) || number < 0 || number > 100000 || Math.abs(number * 100 - Math.round(number * 100)) > 0.00001) throw Error('Enter a positive amount with up to two decimal places.');
        return number;
    };
    function settings(year) {
        const start = Number(year.slice(0, 4));
        return { start: `${start}-08-01`, end: `${start + 1}-07-31`, meetingPoints: 1,
            requirements: { 'First Year': 15, 'Second Year': 12, 'Third Year': 12, 'Fourth Year': 12 } };
    }
    function total(state, memberId, year, bucket, through) {
        return Math.round(Object.values(state.entries || {}).filter(e => e.memberId === memberId && (!year || e.year === year) && (!bucket || category(e) === bucket) && (!through || e.date <= through)).reduce((sum, e) => sum + e.amount, 0) * 100) / 100;
    }
    function requirement(state, memberId, year) {
        const profile = state.members[memberId]?.years?.[year] || {};
        if (profile.exempt) return 0;
        const label = clubYears[clubYear(state, memberId, year) - 1];
        const normal = profile.target ?? state.settings?.[year]?.requirements?.[label] ?? settings(year).requirements[label];
        return profile.seniorBenefit && Number.isFinite(profile.seniorBenefitTarget)
            ? Math.min(normal, profile.seniorBenefitTarget) : normal;
    }
    function approve(state, payload) {
        state = JSON.parse(JSON.stringify(state || {}));
        state.members ||= {}; state.entries ||= {}; state.meetings ||= {}; state.settings ||= {};
        for (const [id, member] of Object.entries(state.members)) member.joinedYear ||= joinedYear(state, id, payload.year);
        const resolved = new Map();
        for (const member of payload.newMembers || []) {
            const name = String(member.name || '').trim();
            if (!name) throw Error('New members need a verified name.');
            const matches = Object.entries(state.members).filter(([id, m]) => normalize(m.name) === normalize(name) && active(state, id, payload.year));
            if (matches.length > 1) throw Error(`Choose the correct existing member for ${name}.`);
            const id = matches[0]?.[0] || member.id;
            if (!matches.length) {
                if (state.members[id]) throw Error('Member ID conflict. Review the scan again.');
                state.members[id] = { name, joinedYear: payload.year, status: 'Member' };
            }
            resolved.set(member.id, id);
        }
        payload = { ...payload, memberIds: payload.memberIds.map(id => resolved.get(id) || id) };
        const config = state.settings[payload.year] || settings(payload.year);
        if (!payload.title.trim() || schoolYear(payload.date) !== payload.year) throw Error('Meeting date must be within the selected school year.');
        if (!payload.memberIds.length || new Set(payload.memberIds).size !== payload.memberIds.length) throw Error('Select each member only once.');
        const meetingId = key(`${payload.year}|${payload.date}|${normalize(payload.title)}`);
        const previous = state.meetings[meetingId];
        const points = previous ? previous.points : amount(config.meetingPoints);
        if (points <= 0) throw Error('Meeting credit must be greater than zero.');
        const meeting = previous || { title: payload.title.trim(), date: payload.date, year: payload.year, points, approvedBy: payload.actor, approvedAt: payload.at, members: {} };
        meeting.members ||= {};
        for (const memberId of payload.memberIds) {
            if (!state.members[memberId]) throw Error('A selected member no longer exists. Refresh and review again.');
            if (!active(state, memberId, payload.year)) throw Error('This member is outside their four club years. Check their first school year.');
            const entryId = `${meetingId}_${memberId}`;
            if (meeting.members[memberId]) continue;
            state.entries[entryId] = { memberId, year: payload.year, amount: points, category: 'participation', reason: meeting.title, date: payload.date, actor: payload.actor, at: payload.at, type: 'attendance', meetingId };
            meeting.members[memberId] = true;
        }
        state.meetings[meetingId] = meeting;
        return state;
    }
    function adjust(state, entryId, entry) {
        state = JSON.parse(JSON.stringify(state || {}));
        if (!state.members?.[entry.memberId]) throw Error('Member not found.');
        if (!active(state, entry.memberId, entry.year)) throw Error('Choose one of this member\'s four club years.');
        entry = { ...entry, category: entry.category || 'service' };
        if (!['participation', 'service', 'unclassified'].includes(entry.category)) throw Error('Choose a valid point category.');
        state.entries ||= {};
        if (state.entries[entryId]) return state;
        const magnitude = amount(Math.abs(entry.amount));
        if (!magnitude || !entry.reason.trim()) throw Error('Enter an amount and a reason.');
        if (entry.amount < 0 && total(state, entry.memberId, entry.year, entry.category) < magnitude) throw Error('A correction cannot reduce this category below zero.');
        const config = state.settings?.[entry.year] || settings(entry.year);
        if (schoolYear(entry.date) !== entry.year) throw Error('Activity date must be within the selected school year.');
        state.entries[entryId] = entry;
        return state;
    }
    function parseCsv(text) {
        const rows = []; let row = [], cell = '', quoted = false;
        text = text.replace(/^\uFEFF/, '');
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (c === '"') {
                if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
                else quoted = !quoted;
            } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
                row.push(cell.trim()); cell = '';
                if (c !== ',') { if (row.some(Boolean)) rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
            } else cell += c;
        }
        if (quoted) throw Error('CSV contains an unclosed quote.');
        row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
        const headers = (rows.shift() || []).map(normalize);
        if (!headers.includes('name') || !headers.includes('points')) throw Error('CSV must include name and points columns. Optional: identity, grade, status.');
        return rows.map((values, index) => {
            if (values.length !== headers.length) throw Error(`CSV row ${index + 2} has the wrong number of columns.`);
            const entry = Object.fromEntries(headers.map((h, i) => [h, values[i]]));
            if (!entry.name) throw Error(`CSV row ${index + 2} needs a name.`);
            if (entry.grade && !grades.includes(entry.grade)) throw Error(`CSV row ${index + 2}: use Freshman, Sophomore, Junior, or Senior.`);
            return { ...entry, points: amount(entry.points) };
        });
    }
    function reportCsv(state, year, through) {
        const rows = [['Name', 'Identity', 'First school year', 'Club year', 'School year', 'Participation', 'Service', 'Unclassified legacy points', 'Year total', 'First year total', 'Second year total', 'Third year total', 'Fourth year total', 'Club total', 'Through date', 'Senior benefit', 'Required points']];
        for (const [id, m] of Object.entries(state.members || {}).filter(([id]) => active(state, id, year)).sort((a, b) => total(state, b[0], null, null, through) - total(state, a[0], null, null, through) || a[1].name.localeCompare(b[1].name))) {
            const first = joinedYear(state, id, year);
            rows.push([m.name, m.identity || '', first, clubYear(state, id, year), year, total(state, id, year, 'participation', through), total(state, id, year, 'service', through), total(state, id, year, 'unclassified', through), total(state, id, year, null, through), ...clubYears.map((_, i) => total(state, id, yearAt(first, i), null, through)), total(state, id, null, null, through), through, m.years?.[year]?.seniorBenefit ? 'Yes' : 'No', requirement(state, id, year) ?? '']);
        }
        // Neutralize spreadsheet formulas in user-controlled text cells.
        return '\uFEFF' + rows.map(row => row.map(value => { let text = String(value); if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = "'" + text; return '"' + text.replace(/"/g, '""') + '"'; }).join(',')).join('\r\n');
    }
    const api = { grades, clubYears, schoolYear, yearAt, validYear, joinedYear, clubYear, active, category, reportCsv, normalize, key, amount, settings, total, requirement, approve, adjust, parseCsv };
    if (typeof module !== 'undefined') module.exports = api;
    else root.PointsCore = api;
})(globalThis);
