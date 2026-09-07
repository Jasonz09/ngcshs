const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('./points-core.js');
test('Senior Benefit applies only to the selected member and year and restores the standard goal when disabled', () => {
    const s = { members: { senior: { name: 'Senior', joinedYear: '2025-2026', years: { '2026-2027': { seniorBenefit: true, seniorBenefitTarget: 6 } } }, other: { name: 'Other', joinedYear: '2025-2026' } } };
    assert.equal(C.requirement(s, 'senior', '2026-2027'), 6);
    assert.equal(C.requirement(s, 'other', '2026-2027'), 12);
    assert.equal(C.requirement(s, 'senior', '2027-2028'), 12);
    assert.equal(C.requirement(s, 'senior', '2025-2026'), 15);
    assert.ok(C.reportCsv(s, '2026-2027', '2027-07-31').includes('"Yes","6"'));
    s.members.senior.years['2026-2027'].seniorBenefit = false;
    assert.equal(C.requirement(s, 'senior', '2026-2027'), 12);
});
test('Senior Benefit never raises a lower normal target and respects exemptions', () => {
    const s = { members: { senior: { name: 'Senior', joinedYear: '2026-2027', years: { '2026-2027': { seniorBenefit: true, seniorBenefitTarget: 6, target: 4 } } } } };
    assert.equal(C.requirement(s, 'senior', '2026-2027'), 4);
    s.members.senior.years['2026-2027'].exempt = true;
    assert.equal(C.requirement(s, 'senior', '2026-2027'), 0);
});
const base = () => ({ members: { alice: { name: 'Alice Example' }, bob: { name: 'Bob Example' } } });
const approval = { title: 'Interest Meeting', date: '2026-09-07', year: '2026-2027', memberIds: ['alice'], actor: 'admin-1', at: '2026-09-07T12:00:00Z' };
test('repeated approval and another page award each member only once', () => {
    let s = C.approve(base(), approval);
    s = C.approve(s, { ...approval, title: ' interest   meeting ', memberIds: ['alice', 'bob'] });
    assert.equal(C.total(s, 'alice', approval.year), 1);
    assert.equal(C.total(s, 'bob', approval.year), 1);
    assert.equal(Object.keys(s.meetings).length, 1);
});
test('unknown and duplicate members abort without modifying the input', () => {
    const s = base();
    assert.throws(() => C.approve(s, { ...approval, memberIds: ['alice', 'missing'] }));
    assert.throws(() => C.approve(s, { ...approval, memberIds: ['alice', 'alice'] }));
    assert.deepEqual(s, base());
});
test('year boundaries and totals are isolated', () => {
    assert.throws(() => C.approve(base(), { ...approval, date: '2025-09-07' }));
    const s = C.approve(base(), approval);
    assert.equal(C.total(s, 'alice', '2027-2028'), 0);
});
test('corrections retain attendance and retries do not add points back', () => {
    let s = C.approve(base(), approval);
    const entry = { memberId: 'alice', year: approval.year, amount: -0.5, category: 'participation', reason: 'Incorrect credit', date: approval.date, actor: 'admin-1', at: approval.at, type: 'correction' };
    s = C.adjust(s, 'correction-1', entry);
    s = C.adjust(s, 'correction-1', entry);
    s = C.approve(s, approval);
    assert.equal(C.total(s, 'alice', approval.year), 0.5);
    assert.equal(Object.keys(s.entries).length, 2);
    assert.throws(() => C.adjust(s, 'correction-2', { ...entry, amount: -1 }));
    assert.throws(() => C.adjust(s, 'correction-3', { ...entry, reason: ' ' }));
});
test('settings changes do not alter existing meeting credit', () => {
    let s = C.approve(base(), approval);
    s.settings[approval.year] = { ...C.settings(approval.year), meetingPoints: 2 };
    s = C.approve(s, { ...approval, memberIds: ['bob'] });
    assert.equal(C.total(s, 'bob', approval.year), 1);
});
test('invalid amounts are rejected', () => {
    for (const value of ['', Infinity, -1, 0.001, 'abc']) assert.throws(() => C.amount(value));
    assert.equal(C.amount('5.5'), 5.5);
});
test('CSV handles quoted names, decimals and rejects malformed imports', () => {
    const rows = C.parseCsv('name,points,grade\r\n"Example, Member",5.5,Junior\r\n');
    assert.equal(rows[0].name, 'Example, Member');
    assert.equal(rows[0].points, 5.5);
    assert.throws(() => C.parseCsv('name,points\nAlice,invalid'));
    assert.throws(() => C.parseCsv('name,points\n"Alice,1'));
    assert.throws(() => C.parseCsv('name,points,grade\nAlice,1,Unknown'));
});
test('August rollover advances club year and archives only after the fourth school year', () => {
    const s = { members: { alice: { name: 'Alice', joinedYear: '2026-2027' } } };
    assert.equal(C.schoolYear('2027-07-31'), '2026-2027');
    assert.equal(C.schoolYear('2027-08-01'), '2027-2028');
    assert.equal(C.clubYear(s, 'alice', '2027-2028'), 2);
    assert.equal(C.active(s, 'alice', '2029-2030'), true);
    assert.equal(C.active(s, 'alice', '2030-2031'), false);
    assert.equal(C.active(s, 'alice', '2025-2026'), false);
});
test('new scan members are created atomically and reused on another approval', () => {
    let s = C.approve({}, { ...approval, memberIds: ['new-alice'], newMembers: [{ id: 'new-alice', name: 'Alice Example' }] });
    assert.equal(s.members['new-alice'].joinedYear, '2026-2027');
    assert.equal(C.total(s, 'new-alice', approval.year, 'participation'), 1);
    s = C.approve(s, { ...approval, memberIds: ['different-id'], newMembers: [{ id: 'different-id', name: ' Alice Example ' }] });
    assert.equal(Object.keys(s.members).length, 1);
    assert.equal(C.total(s, 'new-alice', approval.year), 1);
});
test('new-year scans leave previous-year totals intact and manual points default to service', () => {
    let s = C.approve(base(), approval);
    s = C.approve(s, { ...approval, year: '2027-2028', date: '2027-08-01' });
    s = C.adjust(s, 'manual', { memberId: 'alice', year: '2027-2028', date: '2027-08-02', amount: 2, reason: 'Volunteering', type: 'manual' });
    assert.equal(C.total(s, 'alice', '2026-2027', 'participation'), 1);
    assert.equal(C.total(s, 'alice', '2027-2028', 'participation'), 1);
    assert.equal(C.total(s, 'alice', '2027-2028', 'service'), 2);
    assert.throws(() => C.adjust(s, 'bad-correction', { memberId: 'alice', year: '2027-2028', date: '2027-08-02', amount: -2, category: 'participation', reason: 'Mistake' }));
});
test('closed-year admin corrections work after graduation but fifth-year awards fail', () => {
    let s = C.approve(base(), approval);
    assert.throws(() => C.approve(s, { ...approval, year: '2030-2031', date: '2030-09-01' }));
    s = C.adjust(s, 'old-correction', { memberId: 'alice', year: approval.year, date: approval.date, amount: -1, category: 'participation', reason: 'Duplicate attendance' });
    assert.equal(C.total(s, 'alice', approval.year), 0);
});
test('monthly sponsor report excludes later activity, keeps categories and escapes formulas', () => {
    let s = C.approve(base(), approval);
    s.members.alice.name = '=FORMULA(), "Example"';
    s = C.adjust(s, 'service', { memberId: 'alice', year: approval.year, date: '2026-10-01', amount: 5, reason: 'Service' });
    const csv = C.reportCsv(s, approval.year, '2026-09-30');
    assert.ok(csv.includes('Participation'));
    assert.ok(csv.includes('"\'=FORMULA(), ""Example"""'));
    const rows = csv.split('\r\n');
    assert.ok(rows[1].includes('"1","0","0","1"'));
    assert.equal(C.reportCsv(s, '2030-2031', '2031-07-31').split('\r\n').length, 1);
});
test('OCR preserves a new handwritten name even when a saved roster exists', () => {
    const fs = require('node:fs'), vm = require('node:vm');
    const html = fs.readFileSync(require('node:path').join(__dirname, 'index.html'), 'utf8');
    const start = html.indexOf('function extractAttendanceRecordsFromOcr(');
    const end = html.indexOf('function normalizeAttendanceRecords(', start);
    const context = vm.createContext({
        getAttendanceCurrentRosterRecords: () => [{ fullName: 'Previous Member' }],
        cleanAttendanceName: name => name.trim(),
        makeAttendanceNameRecord: name => ({ fullName: name, key: name.toLowerCase() }),
        getAttendanceOcrConfidence: () => 85,
        getMinimumAttendanceOcrConfidence: () => 64
    });
    vm.runInContext(html.slice(start, end), context);
    const result = context.extractAttendanceRecordsFromOcr({ text: 'New Member', lines: [{ text: 'New Member' }] });
    assert.equal(result.records[0].fullName, 'New Member');
});
