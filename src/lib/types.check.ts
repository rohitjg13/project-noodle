// Self-check for the timetable parsing helpers: node src/lib/types.check.ts
import assert from 'node:assert/strict';
import { expandBlocks, parseDays, timeToMinutes, minutesToTime } from './types.ts';
import { parseTimetableRows } from './timetable-parse.ts';

assert.deepEqual(expandBlocks(''), []);
assert.deepEqual(expandBlocks('BIO21, BIO22'), ['BIO21', 'BIO22']);
assert.deepEqual(expandBlocks('CSD31 to CSD36'), [
	'CSD31',
	'CSD32',
	'CSD33',
	'CSD34',
	'CSD35',
	'CSD36'
]);
assert.deepEqual(expandBlocks('CSD37 to CSD311'), [
	'CSD37',
	'CSD38',
	'CSD39',
	'CSD310',
	'CSD311'
]);
assert.equal(expandBlocks('ECE21 to ECE215').length, 15);
assert.deepEqual(expandBlocks('BIO31, BIO32, CHY3YR'), ['BIO31', 'BIO32', 'CHY3YR']);

// Monsoon 2026 spells days out as Mon/Tue/Wed/Thu/Fri/Sat
assert.deepEqual(parseDays('Mon'), ['Monday']);
assert.deepEqual(parseDays('Tue'), ['Tuesday']);
assert.deepEqual(parseDays('Wed'), ['Wednesday']);
assert.deepEqual(parseDays('Thu'), ['Thursday']);
assert.deepEqual(parseDays('Fri'), ['Friday']);
assert.deepEqual(parseDays('Sat'), ['Saturday']);

// A runaway range is capped instead of minting thousands of batches
assert.equal(expandBlocks('ECE21 to ECE29999').length, 100);

assert.equal(timeToMinutes('01:00 PM'), 780);
assert.equal(timeToMinutes('12:05 AM'), 5);
assert.equal(minutesToTime(780), '1:00 PM');

// The sheet has one row per meeting day. Each is its own slot with its own key; exact
// repeats merge (batches unioned); a second meeting on the same day gets a "#2" key.
const row = (day: string, start: string, end: string, extra: Record<string, string> = {}) => ({
	'Course Code': 'DES104',
	'Course Title': 'Design',
	Component: 'LEC',
	Section: 'LEC1',
	Day: day,
	'Start Time': start,
	'End Time': end,
	Programme: 'DES1YR',
	...extra
});
const slots = parseTimetableRows([
	row('Mon', '03:10 PM', '04:35 PM'),
	row('Mon', '01:00 PM', '02:25 PM'),
	row('Wed', '01:00 PM', '02:25 PM'),
	row('Wed', '01:00 PM', '02:25 PM', { Programme: 'DES2YR', 'Student Block': 'DES21 to DES23' }),
	{ 'Course Code': '-' }
]);
assert.deepEqual(
	slots.map((s) => s.key).sort(),
	['DES104-LEC1|LEC|Monday', 'DES104-LEC1|LEC|Monday#2', 'DES104-LEC1|LEC|Wednesday']
);
const first = slots.find((s) => s.key === 'DES104-LEC1|LEC|Monday')!;
assert.equal(first.startTime, '01:00 PM'); // earliest meeting keeps the plain key
assert.deepEqual([first.base, first.startMin, first.endMin], ['DES104', 780, 865]);
assert.deepEqual(slots.find((s) => s.day === 'Wednesday')!.batches, [
	'DES1YR',
	'DES2YR',
	'DES21',
	'DES22',
	'DES23'
]);

console.log('ok');
