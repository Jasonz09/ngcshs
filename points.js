/* Points use a single transaction so approval and its awards cannot diverge. */
(() => {
    'use strict';
    const C = PointsCore;
    const icons = { plus: 'M12 5v14M5 12h14', download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5', settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0', check: 'm5 12 4 4L19 6', calendar: 'M8 2v4M16 2v4M3 10h18M3 5h18v16H3z', upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5', close: 'm6 6 12 12M6 18 18 6' };
    const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name] || icons.users}"/></svg>`;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    let state = {}, currentYear = C.schoolYear(today()), year = currentYear, busy = false, unsubscribe;
    const host = document.createElement('section');
    host.id = 'points-dashboard';
    host.className = 'points-hub';
    host.hidden = true;
    host.innerHTML = `<div class="points-head"><div><span class="points-eyebrow">THE CLUB, AT A GLANCE</span><h2>Member progress<span>.</span></h2><p>Small contributions. A lasting impact.</p></div><div class="points-head-actions"><label class="points-year-select">School year<select id="points-year"></select></label><button data-action="settings" class="points-icon-button" aria-label="Year Settings" title="Year settings">${icon('settings')}</button><button data-action="export">${icon('download')}<span>Download Report</span></button></div></div>
        <div class="points-stats" id="points-stats"></div>
        <div class="points-workspace"><div class="points-section-nav" role="group" aria-label="Dashboard sections"><button data-panel="members" aria-pressed="true">${icon('users')}Members</button><button data-panel="meetings" aria-pressed="false">${icon('calendar')}Approved Meetings</button><span>Four years. One place.</span></div>
        <div id="points-members-panel"><div class="points-toolbar"><label class="points-search">${icon('search')}<input id="points-search" type="search" placeholder="Find a member..." aria-label="Search members"></label><div class="points-toolbar-actions"><details class="points-import-menu"><summary>${icon('upload')}Import<span aria-hidden="true">⌄</span></summary><div class="points-menu-items"><button data-action="roster">Import Scanner Roster<small>Add names from your saved roster</small></button><button data-action="csv">Import Balances<small>Bring existing points from a CSV</small></button></div></details><button data-action="add" class="primary">${icon('plus')}Add Member</button></div></div>
        <div class="points-list-meta"><span>Ranked by total club points</span><label class="points-switch"><input id="points-archived" type="checkbox"><span aria-hidden="true"></span>Show graduated members</label></div><div class="points-list" id="points-list"></div></div>
        <div id="points-meetings-panel" hidden><div class="points-panel-heading"><h3>Attendance, verified.</h3><p>Approved meetings and the members who received credit.</p></div><div id="points-meetings"></div></div></div>
        <p id="points-message" class="points-message" role="status" aria-live="polite"></p>`;
    document.querySelector('.attendance-dropzone')?.closest('section')?.querySelector('.container')?.append(host);
    const dialog = document.createElement('dialog');
    dialog.className = 'points-dialog';
    document.body.append(dialog);
    const message = text => { host.querySelector('#points-message').textContent = text; };
    const members = () => Object.entries(state.members || {}).sort((a, b) => C.total(state, b[0], null, null, C.settings(year).end) - C.total(state, a[0], null, null, C.settings(year).end) || a[1].name.localeCompare(b[1].name));
    const config = () => state.settings?.[year] || C.settings(year);
    const profile = m => m.years?.[year] || {};
    const target = (m, id) => C.requirement(state, id, year);
    function render() {
        const years = [...new Set([year, currentYear, ...Object.keys(state.settings || {}), ...Object.values(state.members || {}).map(m => m.joinedYear).filter(Boolean), ...Object.values(state.entries || {}).map(e => e.year)])].sort().reverse();
        host.querySelector('#points-year').innerHTML = years.map(y => `<option ${y === year ? 'selected' : ''}>${esc(y)}</option>`).join('');
        const list = members().filter(([id]) => C.active(state, id, year) || (host.querySelector('#points-archived').checked && C.clubYear(state, id, year) > 4));
        const completed = list.filter(([id, m]) => target(m, id) > 0 && C.total(state, id, year) >= target(m, id)).length;
        host.querySelector('#points-stats').innerHTML = [[list.length, 'Members', 'users', 'Growing together'], [completed, 'Yearly goals met', 'check', 'Making every point count'], [Object.values(state.meetings || {}).filter(m => m.year === year).length, 'Approved meetings', 'calendar', 'Participation in action']].map(([n, title, glyph, note]) => `<div class="points-stat"><div><span>${title}</span><strong>${n}</strong><small>${note}</small></div><span class="points-stat-icon">${icon(glyph)}</span></div>`).join('');
        const search = C.normalize(host.querySelector('#points-search').value);
        host.querySelector('#points-list').innerHTML = list.filter(([, m]) => C.normalize(m.name).includes(search)).map(([id, m]) => {
            const points = C.total(state, id, year), goal = target(m, id), first = C.joinedYear(state, id, currentYear);
            const lifetime = C.total(state, id, null, null, C.settings(year).end);
            return `<article class="points-member ${lifetime === 1 ? 'points-provisional' : ''}"><button class="points-person" data-member="${esc(id)}"><b>${esc(m.name)}</b><small>${C.clubYear(state, id, year) > 4 ? 'Graduated' : esc(C.clubYears[C.clubYear(state, id, year) - 1])} / Joined ${esc(first)}</small><small>${profile(m).exempt ? 'Exempt' : goal === undefined ? '' : `${points} / ${goal} yearly goal`}</small></button><div class="points-year-cells">${C.clubYears.map((label, i) => {
                const y = C.yearAt(first, i), future = y > currentYear;
                return `<button data-member="${esc(id)}" data-year="${y}" ${future ? 'disabled' : ''}><small>${label}</small><strong>${future ? '-' : C.total(state, id, y)}</strong><small>${y}${y < currentYear ? ' / Closed' : ''}</small></button>`;
            }).join('')}</div><span class="points-club-total"><strong>${lifetime}</strong><small>Club total</small></span></article>`;
        }).join('') || `<div class="points-empty"><span class="points-empty-icon">${icon(search ? 'search' : 'users')}</span><h3>${search ? 'No matching members' : 'Your next chapter starts here'}</h3><p>${search ? 'Try another name or include graduated members.' : 'Add your first member, import a roster, or approve a sign-up sheet. Their progress will appear here.'}</p>${search ? '' : `<button class="primary" data-action="add">${icon('plus')}Add your first member</button>`}</div>`;
        host.querySelectorAll('.points-person').forEach(button => {
            if (!state.members[button.dataset.member]?.years?.[year]?.seniorBenefit) return;
            const badge = document.createElement('small');
            badge.className = 'points-benefit-label'; badge.textContent = 'Senior Benefit'; button.append(badge);
        });
        host.querySelector('#points-meetings').innerHTML = Object.values(state.meetings || {}).filter(m => m.year === year).sort((a, b) => b.date.localeCompare(a.date)).map(m => `<div class="points-history"><b>${esc(m.title)}</b><p>${esc(m.date)} / ${Object.keys(m.members || {}).length} members / ${m.points} point(s) each</p><details><summary>Verified names</summary><p>${Object.keys(m.members || {}).map(id => esc(state.members?.[id]?.name || id)).join(', ')}</p></details></div>`).join('') || '<p>No approved meetings this year.</p>';
    }
    function modal(title, body, submit, onSubmit) {
        if (dialog.open) dialog.close();
        dialog.innerHTML = `<div class="points-dialog-header"><div><span class="points-eyebrow">MEMBER MANAGEMENT</span><h2 id="points-dialog-title">${esc(title)}</h2></div><button type="button" class="points-close points-icon-button" aria-label="Close">${icon('close')}</button></div><form><div class="points-dialog-body">${body}<p class="points-message" role="alert"></p></div>${submit ? `<div class="points-dialog-actions"><button type="button" class="points-cancel">Cancel</button><button class="primary" type="submit">${esc(submit)}${icon('check')}</button></div>` : ''}</form>`;
        dialog.setAttribute('aria-labelledby', 'points-dialog-title');
        dialog.querySelector('.points-close').onclick = () => dialog.close();
        const cancel = dialog.querySelector('.points-cancel');
        if (cancel) cancel.onclick = () => dialog.close();
        dialog.querySelector('form').onsubmit = async e => {
            e.preventDefault();
            if (busy) return;
            busy = true;
            dialog.querySelectorAll('button').forEach(b => b.disabled = true);
            try { await onSubmit(new FormData(e.target)); dialog.close(); }
            catch (error) { dialog.querySelector('[role="alert"]').textContent = error.message; }
            finally { busy = false; dialog.querySelectorAll('button').forEach(b => b.disabled = false); }
        };
        dialog.showModal();
        dialog.querySelector('input:not([type="checkbox"]), select, .points-close')?.focus({ preventScroll: true });
    }
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    async function write(change) {
        if (!auth?.currentUser || !database) throw Error('Sign in with your admin account to save points.');
        const actor = auth.currentUser.uid;
        const at = new Date().toISOString();
        await database.ref('clubPoints').once('value');
        const result = await database.ref('clubPoints').transaction(current => {
            const s = current || {};
            for (const [id, member] of Object.entries(s.members || {})) member.joinedYear ||= C.joinedYear(s, id, currentYear);
            return change(s, actor, at);
        }, undefined, false);
        if (!result.committed) throw Error('Changes were not saved. Please retry.');
        state = result.snapshot.val() || {};
        render();
        message('Saved successfully.');
    }
    const field = (label, name, value = '', type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
    function editMember(id, memberYear = year) {
        const year = memberYear;
        const m = state.members?.[id] || {}, p = m.years?.[year] || {};
        modal(id ? 'Member Settings' : 'Add Member', `${field('Full name', 'name', m.name, 'text', 'required maxlength="100"')}${field('School email or student ID (optional)', 'identity', m.identity)}${field('First school year in the club', 'joinedYear', id ? C.joinedYear(state, id, currentYear) : year, 'text', 'required pattern="[0-9]{4}-[0-9]{4}"')}<p>Members leave the active list when their fifth school year begins. Their history remains available.</p><label>Membership status<select name="status">${['Member', 'Not Paid', 'Executive Board'].map(s => `<option ${m.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>${field(`Individual requirement for ${year} (blank uses club-year setting)`, 'target', p.target ?? '', 'number', 'min="0" step="0.01"')}<label><span><input type="checkbox" name="exempt" ${p.exempt ? 'checked' : ''}> Exempt from yearly requirement</span></label>`, 'Save Member', async data => {
            const memberId = id || crypto.randomUUID();
            const name = data.get('name').trim(), identity = data.get('identity').trim();
            if (!name) throw Error('Enter a member name.');
            const joinedYear = data.get('joinedYear');
            if (!C.validYear(joinedYear) || joinedYear > currentYear) throw Error('Enter a valid first school year, no later than the current year.');
            const override = data.get('target') === '' ? null : C.amount(data.get('target'));
            const seniorBenefit = data.has('seniorBenefit');
            const seniorBenefitTarget = seniorBenefit ? C.amount(data.get('seniorBenefitTarget')) : null;
            if (seniorBenefit && data.has('exempt')) throw Error('Choose Senior Benefit or exemption, not both.');
            await write((s, actor, at) => {
                s.members ||= {};
                if (identity && Object.entries(s.members).some(([other, member]) => other !== memberId && C.normalize(member.identity) === C.normalize(identity))) throw Error('That email or student ID already belongs to a member.');
                const member = s.members[memberId] || {};
                if (Object.values(s.entries || {}).some(e => e.memberId === memberId && (e.year < joinedYear || e.year > C.yearAt(joinedYear, 3)))) throw Error('The first school year must include all existing points within four club years.');
                member.joinedYear = joinedYear;
                member.name = name; member.identity = identity; member.status = data.get('status'); member.years ||= {};
                const label = C.clubYears[Number(year.slice(0, 4)) - Number(joinedYear.slice(0, 4))];
                const normal = override ?? s.settings?.[year]?.requirements?.[label] ?? C.settings(year).requirements[label];
                if (seniorBenefit && !(seniorBenefitTarget < normal)) throw Error('The Senior Benefit requirement must be lower than the normal yearly requirement.');
                member.years[year] = { ...member.years[year], target: override, exempt: data.has('exempt'), seniorBenefit, seniorBenefitTarget, updatedBy: actor, updatedAt: at };
                s.members[memberId] = member;
                return s;
            });
        });
        const benefit = document.createElement('div');
        benefit.className = 'points-benefit-panel';
        benefit.innerHTML = `<label><span><input type="checkbox" name="seniorBenefit" ${p.seniorBenefit ? 'checked' : ''}> Senior Benefit for ${esc(year)}</span></label><p>Enable only after confirming this senior qualifies. Other school years and earned points stay unchanged.</p>${field('Reduced yearly requirement', 'seniorBenefitTarget', p.seniorBenefitTarget ?? '', 'number', 'min="0" step="0.01"')}`;
        dialog.querySelector('.points-dialog-body').insertBefore(benefit, dialog.querySelector('[role="alert"]'));
        const toggle = benefit.querySelector('[name="seniorBenefit"]');
        const input = benefit.querySelector('[name="seniorBenefitTarget"]');
        const update = () => { input.disabled = !toggle.checked; input.required = toggle.checked; input.closest('label').hidden = !toggle.checked; };
        toggle.onchange = update;
        update();
    }
    function detail(id, detailYear = year, bucket = 'participation') {
        const m = state.members[id];
        if (!C.active(state, id, detailYear)) detailYear = C.yearAt(C.joinedYear(state, id, currentYear), 3);
        const entries = Object.values(state.entries || {}).filter(e => e.memberId === id && e.year === detailYear);
        const history = entries.filter(e => C.category(e) === bucket).sort((a, b) => b.at.localeCompare(a.at));
        const buckets = ['participation', 'service', ...(entries.some(e => C.category(e) === 'unclassified') ? ['unclassified'] : [])];
        modal(m.name, `<p>${esc(C.clubYears[C.clubYear(state, id, detailYear) - 1])} / ${esc(detailYear)} / <b>${C.total(state, id, detailYear)} points</b></p>${detailYear < currentYear ? '<p class="points-closed">Closed school year. Only explicit admin adjustments can change these totals; new scans use their meeting date.</p>' : ''}<div class="points-category-tabs">${buckets.map(b => `<button type="button" data-category="${b}" aria-pressed="${b === bucket}">${b === 'unclassified' ? 'Legacy / Unclassified' : b === 'service' ? 'Service' : 'Participation'}<strong>${C.total(state, id, detailYear, b)}</strong></button>`).join('')}</div><div class="points-tools"><button type="button" data-detail="add">+ Add Points</button><button type="button" class="correction" data-detail="subtract">- Correct Mistake</button><button type="button" data-detail="edit">Member Settings</button></div>${history.map(e => `<div class="points-history"><b>${e.amount > 0 ? '+' : ''}${e.amount} points</b> / ${esc(e.reason)}<p>${esc(e.date)} / ${esc(e.type)}<br><small>Recorded ${esc(e.at)} by ${esc(e.actor)}</small></p></div>`).join('') || '<p>No entries in this category.</p>'}`, null);
        dialog.querySelectorAll('[data-category]').forEach(button => button.onclick = () => detail(id, detailYear, button.dataset.category));
        const benefit = m.years?.[detailYear]?.seniorBenefit;
        const note = document.createElement('p');
        note.className = benefit ? 'points-benefit-label' : '';
        note.textContent = `${benefit ? 'Senior Benefit / ' : ''}Yearly requirement: ${C.requirement(state, id, detailYear) ?? 'Not set'} points`;
        dialog.querySelector('.points-category-tabs').before(note);
        dialog.querySelectorAll('[data-detail]').forEach(button => button.onclick = () => button.dataset.detail === 'edit' ? editMember(id, detailYear) : adjustment(id, button.dataset.detail === 'subtract', detailYear, button.dataset.detail === 'subtract' ? bucket : 'service'));
    }
    function adjustment(id, subtract, entryYear, bucket) {
        modal(subtract ? 'Correct a Mistake' : 'Add Points', `<p>${esc(state.members[id].name)} / ${esc(entryYear)}${subtract ? '<br>Use this only to reverse an incorrect award. The original entry stays in the history.' : ''}</p><label>Category<select name="category">${['service', 'participation', ...(bucket === 'unclassified' ? ['unclassified'] : [])].map(b => `<option value="${b}" ${b === bucket ? 'selected' : ''}>${b === 'service' ? 'Service' : b === 'participation' ? 'Participation' : 'Legacy / Unclassified'}</option>`).join('')}</select></label>${field('Points', 'amount', 1, 'number', 'required min="0.01" max="100000" step="0.01"')}${field('Activity date', 'date', entryYear === currentYear ? today() : C.settings(entryYear).end, 'date', 'required')}${field(subtract ? 'What mistake are you correcting?' : 'Activity or reason', 'reason', '', 'text', 'required maxlength="300"')}${entryYear < currentYear ? '<label><span><input type="checkbox" required> I intend to adjust this closed school year as an admin.</span></label>' : ''}`, subtract ? 'Record Correction' : 'Add Points', async data => {
            const entryId = crypto.randomUUID();
            const points = C.amount(data.get('amount')) * (subtract ? -1 : 1);
            await write((s, actor, at) => C.adjust(s, entryId, { memberId: id, year: entryYear, amount: points, category: data.get('category'), reason: data.get('reason').trim(), date: data.get('date'), actor, at, type: subtract ? 'correction' : 'manual' }));
        });
    }
    function settings() {
        const c = config();
        modal('Year Settings', `<p>Requirements apply to ${esc(year)}. School years run August 1 through July 31. Individual overrides and exemptions take precedence.</p>${field('School year (YYYY-YYYY)', 'year', year, 'text', 'required pattern="[0-9]{4}-[0-9]{4}"')}${field('Points per meeting', 'credit', c.meetingPoints, 'number', 'required min="0.01" step="0.01"')}${C.clubYears.map(g => field(`${g} required points`, g, c.requirements[g] ?? C.settings(year).requirements[g], 'number', 'required min="0" step="0.01"')).join('')}<p>Existing meeting awards keep their original value. Changing a requirement updates progress displays.</p>`, 'Save Settings', async data => {
            const selected = data.get('year');
            if (!C.validYear(selected)) throw Error('Enter consecutive school years.');
            const c = { ...C.settings(selected), meetingPoints: C.amount(data.get('credit')), requirements: Object.fromEntries(C.clubYears.map(g => [g, C.amount(data.get(g))])) };
            if (!c.meetingPoints) throw Error('Meeting credit must be greater than zero.');
            await write(s => { s.settings ||= {}; s.settings[selected] = c; return s; });
            year = selected; render();
        });
    }
    function importRoster() {
        const names = attendanceMemberRoster.map(m => m.fullName).filter(Boolean);
        modal('Import Scanner Roster', `<p>Add members from your saved scanner roster. Existing names are skipped, and points stay unchanged.</p><div class="points-import-preview"><span class="points-empty-icon">${icon('users')}</span><strong>${names.length} names ready to import</strong><p>${names.length ? 'Review your saved roster before continuing.' : 'Your scanner roster is empty. Save names in the scanner roster first, or add a member directly.'}</p></div>`, 'Import Members', async () => {
            if (!names.length) throw Error('Save at least one name in the scanner roster first.');
            const records = names.map(name => ({ id: crypto.randomUUID(), name }));
            await write(s => {
                s.members ||= {};
                for (const { id, name } of records) if (!Object.values(s.members).some(m => C.normalize(m.name) === C.normalize(name))) s.members[id] = { name, status: 'Member', joinedYear: year };
                return s;
            });
        });
        dialog.querySelector('[type="submit"]').disabled = !names.length;
    }
    function importCsv() {
        modal('Import Opening Balances', `<p>Import existing points into ${esc(year)}. This is for members with no point history in this year.</p><p>CSV columns: <b>name,points,identity,status,category,joinedyear</b>. Only name and points are required. Category is participation or service; blank preserves the balance as unclassified. First school year defaults to the selected year for new members.</p><label>CSV file<input type="file" name="file" accept=".csv,text/csv" required></label><label>Balance date<input type="date" name="date" value="${esc(year === currentYear ? today() : C.settings(year).end)}" required></label><div id="points-import-preview"></div>`, 'Import Verified Balances', async data => {
            const rows = C.parseCsv(await data.get('file').text());
            if (!rows.length) throw Error('The file contains no member rows.');
            const records = rows.map(row => ({ ...row, id: crypto.randomUUID() }));
            await write((s, actor, at) => {
                s.members ||= {}; s.entries ||= {}; s.imports ||= {};
                const seen = new Set();
                for (const row of records) {
                    const matches = Object.entries(s.members).filter(([, m]) => row.identity ? C.normalize(m.identity) === C.normalize(row.identity) : C.normalize(m.name) === C.normalize(row.name));
                    if (matches.length > 1) throw Error(`Multiple members named ${row.name}. Include identity to distinguish them.`);
                    const id = matches[0]?.[0] || row.id;
                    if (seen.has(id)) throw Error(`Duplicate member in CSV: ${row.name}.`);
                    seen.add(id);
                    const importId = `${year}_${id}`;
                    if (s.imports[importId] || Object.values(s.entries).some(e => e.memberId === id && e.year === year)) throw Error(`${row.name} already has points or an imported balance this year. Use a correction instead.`);
                    const joinedYear = row.joinedyear || year;
                    if (!C.validYear(joinedYear) || !['participation', 'service', 'unclassified'].includes(row.category || 'unclassified')) throw Error('Check the category and joinedyear columns.');
                    const member = s.members[id] || { name: row.name, identity: row.identity || '', status: row.status || 'Member', joinedYear };
                    member.years ||= {};
                    member.years[year] ||= {};
                    s.members[id] = member;
                    if (!C.active(s, id, year)) throw Error(`${row.name} is outside their four club years.`);
                    const entry = { memberId: id, year, amount: row.points, category: row.category || 'unclassified', reason: 'Imported opening balance', date: data.get('date'), actor, at, type: 'import' };
                    const c = s.settings?.[year] || C.settings(year);
                    if (entry.date < c.start || entry.date > c.end) throw Error('Balance date must be within the selected school year.');
                    if (row.points) s = C.adjust(s, `import_${importId}`, entry);
                    s.imports[importId] = { actor, at, amount: row.points };
                }
                return s;
            });
        });
        const submit = dialog.querySelector('[type="submit"]');
        submit.disabled = true;
        dialog.querySelector('[name="file"]').onchange = async e => {
            submit.disabled = true;
            try {
                const rows = C.parseCsv(await e.target.files[0].text());
                dialog.querySelector('#points-import-preview').innerHTML = `<p>Review ${rows.length} members before importing:</p><div class="points-review-list">${rows.map(row => `<p>${esc(row.name)} / ${row.points} points / ${esc(row.category || 'Unclassified')} / joined ${esc(row.joinedyear || year)}</p>`).join('')}</div>`;
                submit.disabled = !rows.length;
                dialog.querySelector('[role="alert"]').textContent = '';
            } catch (error) { dialog.querySelector('[role="alert"]').textContent = error.message; }
        };
    }
    function exportReport() {
        modal('Download Sponsor Report', `<p>Download a spreadsheet-compatible CSV for ${esc(year)}, with participation, service, each club year's total, and the combined total. Historical reports include members who were active in the selected year.</p>${field('Include points through', 'through', year === currentYear ? today() : C.settings(year).end, 'date', 'required')}<p>Choose the last day of a month for your monthly report. Totals include activity dated on or before that day, including later admin corrections.</p>`, 'Download CSV', async data => {
            const through = data.get('through');
            if (C.schoolYear(through) !== year) throw Error('Choose a date within the selected school year.');
            const fresh = (await database.ref('clubPoints').once('value')).val() || {};
            for (const [id, member] of Object.entries(fresh.members || {})) member.joinedYear ||= C.joinedYear(fresh, id, currentYear);
            const url = URL.createObjectURL(new Blob([C.reportCsv(fresh, year, through)], { type: 'text/csv;charset=utf-8' }));
            const a = document.createElement('a'); a.href = url; a.download = `CSHS-points-${year}-through-${through}.csv`;
            document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
    }
    async function review() {
        try {
            if (!auth?.currentUser) throw Error('Sign in as an admin to approve attendance.');
            state = (await database.ref('clubPoints').once('value')).val() || {};
            const title = document.getElementById('attendance-meeting-title').value.trim();
            const date = document.getElementById('attendance-scan-date').value;
            const names = normalizeAttendanceNamesForSave();
            if (!title || !date || !names.length) throw Error('Enter a meeting title, date, and at least one name first.');
            const approvedYear = C.schoolYear(date);
            if (date > today()) throw Error('Choose a meeting date that is not in the future.');
            const meetingId = C.key(`${approvedYear}|${date}|${C.normalize(title)}`);
            const credit = state.meetings?.[meetingId]?.points ?? state.settings?.[approvedYear]?.meetingPoints ?? 1;
            for (const [id, member] of Object.entries(state.members || {})) member.joinedYear ||= C.joinedYear(state, id, currentYear);
            const options = members().filter(([id]) => C.active(state, id, approvedYear));
            const newIds = names.map(() => crypto.randomUUID());
            modal('Review Attendance', `<p>${esc(title)} / ${esc(date)} / ${esc(approvedYear)}</p><p>Check every name against the sheet. New names will be added on approval. Each selected member receives ${credit} participation point(s); members already credited for this meeting are skipped. Reuse the same date and title for additional pages.</p><div class="points-review"><div>${attendanceImageData ? '<img id="points-review-image" alt="Uploaded sign-up sheet">' : '<p>Review against your original sheet.</p>'}</div><div class="points-review-list">${names.map((name, index) => {
                const matches = options.filter(([, m]) => C.normalize(m.name) === C.normalize(name.fullName));
                return `<label>${esc(name.fullName)}<select name="name-${index}" required><option value="">Choose member</option><option value="new" ${matches.length === 0 ? 'selected' : ''}>Add as new member: ${esc(name.fullName)}</option><option value="skip">Exclude this line</option>${options.map(([id, m]) => `<option value="${esc(id)}" ${matches.length === 1 && matches[0][0] === id ? 'selected' : ''}>${esc(m.name)}${m.identity ? ` (${esc(m.identity)})` : ''}</option>`).join('')}</select></label>`;
            }).join('')}</div></div><label><span><input type="checkbox" required> I verified these members against the uploaded sheet.</span></label>${approvedYear < currentYear ? '<label><span><input type="checkbox" required> I intend to add attendance to this closed school year as an admin.</span></label>' : ''}`, 'Approve & Award Points', async data => {
                const ids = [], newMembers = [];
                names.forEach((name, index) => { const choice = data.get(`name-${index}`); if (choice === 'new') { ids.push(newIds[index]); newMembers.push({ id: newIds[index], name: name.fullName }); } else if (choice && choice !== 'skip') ids.push(choice); });
                await write((s, actor, at) => C.approve(s, { title, date, year: approvedYear, memberIds: ids, newMembers, actor, at }));
                year = approvedYear; render();
                clearAttendanceScan();
                message('Attendance approved and points saved. Duplicate credits were skipped.');
            });
            const image = dialog.querySelector('#points-review-image');
            if (image) image.src = attendanceImageData;
        } catch (error) { setAttendanceStatus(error.message, 'warning'); message(error.message); }
    }
    host.addEventListener('click', e => {
        const button = e.target.closest('button');
        if (!button) return;
        if (button.dataset.panel) {
            const panel = button.dataset.panel;
            host.querySelectorAll('[data-panel]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.panel === panel)));
            host.querySelector('#points-members-panel').hidden = panel !== 'members';
            host.querySelector('#points-meetings-panel').hidden = panel !== 'meetings';
            return;
        }
        host.querySelector('.points-import-menu').open = false;
        if (button.dataset.member) detail(button.dataset.member, button.dataset.year || year);
        else ({ add: () => editMember(), settings, roster: importRoster, csv: importCsv, export: exportReport })[button.dataset.action]?.();
    });
    host.querySelector('#points-search').oninput = render;
    host.querySelector('#points-year').onchange = e => { year = e.target.value; render(); };
    host.querySelector('#points-archived').onchange = render;
    document.addEventListener('click', event => {
        if (!event.target.closest('.points-import-menu')) host.querySelector('.points-import-menu').open = false;
    });
    host.querySelector('.points-import-menu').addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.currentTarget.open = false;
            event.currentTarget.querySelector('summary').focus();
        }
    });
    function rollover() {
        if (busy) return;
        const next = C.schoolYear(today());
        if (next !== currentYear) {
            currentYear = next;
            year = next;
            if (!busy) dialog.close();
            render();
        }
    }
    setInterval(rollover, 30000);
    document.addEventListener('visibilitychange', rollover);
    window.clubPoints = { review };
    if (typeof auth !== 'undefined' && auth) auth.onAuthStateChanged(async user => {
        unsubscribe?.(); unsubscribe = null;
        state = {}; host.hidden = !user; dialog.close(); render();
        if (!user) return;
        const ref = database.ref('clubPoints');
        const listener = ref.on('value', snapshot => {
            state = snapshot.val() || {};
            for (const [id, member] of Object.entries(state.members || {})) member.joinedYear ||= C.joinedYear(state, id, currentYear);
            render(); message('');
        }, () => message('Points access is not configured. Deploy the database rules and grant your account points-admin access.'));
        unsubscribe = () => ref.off('value', listener);
    });
})();
