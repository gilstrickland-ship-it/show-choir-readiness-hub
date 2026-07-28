// ============================================================================
// Unit tests — combined roster CSV import parser (T008)
// ----------------------------------------------------------------------------
// Pure functions only; no DB, no globalSetup (runs under vitest.unit.config.ts).
// Covers: header variants, multi-guardian in BOTH shapes (repeated columns and
// repeated rows), health-column skip, and per-row validation errors.
// ============================================================================

import { describe, test, expect } from 'vitest';
import {
  parseRosterCsv,
  parseCsv,
  isValidEmail,
  gradYearFromGrade,
  DEFAULT_SIZE_KEYS,
  importIssues,
} from '@/lib/roster/import';

// Local-time constructors so getMonth()/getFullYear() are tz-stable in CI.
const FALL = new Date(2026, 8, 1); // Sep 2026 — fall term (Aug–Dec)
const SPRING = new Date(2026, 2, 1); // Mar 2026 — spring term (Jan–Jul)

describe('parseCsv tokenizer', () => {
  test('handles quoted fields with commas and escaped quotes', () => {
    const grid = parseCsv('a,"b,c","d""e"\n1,2,3\n');
    expect(grid[0]).toEqual(['a', 'b,c', 'd"e']);
    expect(grid[1]).toEqual(['1', '2', '3']);
    expect(grid.length).toBe(2);
  });

  test('handles newlines inside quoted fields', () => {
    const grid = parseCsv('name,note\n"Smith","line1\nline2"');
    expect(grid.length).toBe(2);
    expect(grid[1]).toEqual(['Smith', 'line1\nline2']);
  });

  test('strips a leading BOM', () => {
    const grid = parseCsv('﻿a,b\n1,2');
    expect(grid[0]).toEqual(['a', 'b']);
  });
});

describe('isValidEmail', () => {
  test('accepts and rejects', () => {
    expect(isValidEmail('jo@example.com')).toBe(true);
    expect(isValidEmail('nope')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
  });
});

describe('header variants', () => {
  test('separate first/last columns', () => {
    const { rows, errors } = parseRosterCsv('First Name,Last Name,Grad Year\nAva,Nguyen,2027');
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ firstName: 'Ava', lastName: 'Nguyen', gradYear: 2027 });
  });

  test('combined "Student Name" column is split', () => {
    const { rows } = parseRosterCsv('Student Name,Grad\nAva Nguyen,2027');
    expect(rows[0]).toMatchObject({ firstName: 'Ava', lastName: 'Nguyen', gradYear: 2027 });
  });

  test('"Last, First" combined name (quoted so the comma is not a delimiter)', () => {
    const { rows } = parseRosterCsv('Name\n"Nguyen, Ava"');
    expect(rows[0]).toMatchObject({ firstName: 'Ava', lastName: 'Nguyen' });
  });

  test('2-digit grad year shorthand normalizes to 20xx', () => {
    const { rows } = parseRosterCsv('First,Last,Class Of\nAva,Nguyen,27');
    expect(rows[0].gradYear).toBe(2027);
  });

  test('size columns matched case-insensitively against program size keys', () => {
    const { rows } = parseRosterCsv(
      'First,Last,TOP,Bottom Size,Size Shoe\nAva,Nguyen,M,8,7.5',
      ['top', 'bottom', 'shoe'],
    );
    expect(rows[0].sizes).toEqual({ top: 'M', bottom: '8', shoe: '7.5' });
  });

  test('size column not in the program keys is ignored (not a size, not an error)', () => {
    const { rows, errors } = parseRosterCsv('First,Last,Glove\nAva,Nguyen,S', ['top']);
    expect(errors).toHaveLength(0);
    expect(rows[0].sizes).toEqual({});
  });

  test('DEFAULT_SIZE_KEYS drive matching when none passed', () => {
    expect(DEFAULT_SIZE_KEYS).toContain('top');
    const { rows } = parseRosterCsv('First,Last,Top\nAva,Nguyen,L');
    expect(rows[0].sizes).toEqual({ top: 'L' });
  });
});

describe('multi-guardian — repeated column groups', () => {
  test('guardian1 + guardian2 in one row', () => {
    const csv =
      'First,Last,Guardian Name,Guardian Email,Guardian Phone,Guardian2 Name,Guardian 2 Email\n' +
      'Ava,Nguyen,Bly Nguyen,bly@example.com,555-1000,Cam Nguyen,cam@example.com';
    const { rows, errors } = parseRosterCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].guardians).toHaveLength(2);
    expect(rows[0].guardians[0]).toMatchObject({
      name: 'Bly Nguyen',
      email: 'bly@example.com',
      phone: '555-1000',
    });
    expect(rows[0].guardians[1]).toMatchObject({ name: 'Cam Nguyen', email: 'cam@example.com' });
  });

  test('guardian relationship column is captured, not mistaken for name', () => {
    const csv =
      'First,Last,Guardian Name,Guardian Relationship\nAva,Nguyen,Bly Nguyen,Mother';
    const { rows } = parseRosterCsv(csv);
    expect(rows[0].guardians[0]).toMatchObject({ name: 'Bly Nguyen', relationship: 'Mother' });
  });
});

describe('multi-guardian — repeated rows', () => {
  test('same student name + grad on consecutive rows merges guardians', () => {
    const csv =
      'First,Last,Grad,Guardian Name,Guardian Email\n' +
      'Ava,Nguyen,2027,Bly Nguyen,bly@example.com\n' +
      'Ava,Nguyen,2027,Cam Nguyen,cam@example.com\n' +
      'Leo,Park,2026,Dana Park,dana@example.com';
    const { rows, errors } = parseRosterCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ firstName: 'Ava', lastName: 'Nguyen', mergedRowCount: 1 });
    expect(rows[0].guardians.map((g) => g.name)).toEqual(['Bly Nguyen', 'Cam Nguyen']);
    expect(rows[0].sourceRows).toEqual([1, 2]);
    expect(rows[1]).toMatchObject({ firstName: 'Leo', mergedRowCount: 0 });
  });

  test('continuation row with blank student columns merges into prior student', () => {
    const csv =
      'First,Last,Guardian Name\n' +
      'Ava,Nguyen,Bly Nguyen\n' +
      ',,Cam Nguyen';
    const { rows } = parseRosterCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].guardians.map((g) => g.name)).toEqual(['Bly Nguyen', 'Cam Nguyen']);
    expect(rows[0].mergedRowCount).toBe(1);
  });
});

describe('health-column skip (Constitution III)', () => {
  test('health-keyword columns are dropped entirely and reported', () => {
    const csv =
      'First,Last,Medical Notes,Allergies,DOB,Home Address,Emergency Contact,Top\n' +
      'Ava,Nguyen,peanut allergy,bees,2009-01-01,123 Main St,Grandma 555,M';
    const { rows, skippedColumns } = parseRosterCsv(csv, ['top']);
    const headers = skippedColumns.map((s) => s.header);
    expect(headers).toEqual(
      expect.arrayContaining([
        'Medical Notes',
        'Allergies',
        'DOB',
        'Home Address',
        'Emergency Contact',
      ]),
    );
    // Never ingested — not into sizes, not anywhere on the parsed row.
    expect(rows[0].sizes).toEqual({ top: 'M' });
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toContain('peanut');
    expect(serialized).not.toContain('123 Main');
    expect(serialized).not.toContain('2009-01-01');
  });

  test('skip notice text names the product-agnostic refusal', () => {
    const { skippedColumns } = parseRosterCsv('First,Last,Health Info\nA,B,x', ['top']);
    expect(skippedColumns).toHaveLength(1);
    expect(skippedColumns[0].reason).toMatch(/does not store health or medical/i);
  });
});

describe('gradYearFromGrade helper', () => {
  test('12th grade graduates NEXT year in the fall term (Aug–Dec)', () => {
    expect(gradYearFromGrade(12, FALL)).toBe(2027);
    expect(gradYearFromGrade('12', FALL)).toBe(2027);
  });

  test('12th grade graduates THIS year in the spring term (Jan–Jul)', () => {
    expect(gradYearFromGrade(12, SPRING)).toBe(2026);
  });

  test('every lower grade adds a year (9–12 supported)', () => {
    // Fall 2026: senior class of 2027, so 11→2028, 10→2029, 9→2030.
    expect(gradYearFromGrade(11, FALL)).toBe(2028);
    expect(gradYearFromGrade(10, FALL)).toBe(2029);
    expect(gradYearFromGrade(9, FALL)).toBe(2030);
    // Spring 2026: senior class of 2026, so 9→2029.
    expect(gradYearFromGrade(9, SPRING)).toBe(2029);
  });

  test('parses messy grade strings ("11th", "Grade 10", "Gr. 9")', () => {
    expect(gradYearFromGrade('11th', FALL)).toBe(2028);
    expect(gradYearFromGrade('Grade 10', FALL)).toBe(2029);
    expect(gradYearFromGrade('Gr. 9', FALL)).toBe(2030);
  });

  test('grades outside 9–12 and unparseable values are invalid (null)', () => {
    expect(gradYearFromGrade(8, FALL)).toBeNull();
    expect(gradYearFromGrade(13, FALL)).toBeNull();
    expect(gradYearFromGrade('K', FALL)).toBeNull();
    expect(gradYearFromGrade('', FALL)).toBeNull();
    expect(gradYearFromGrade('senior', FALL)).toBeNull();
  });

  test('a timezone param reads the term boundary in that zone (Jul-31-evening Chicago)', () => {
    // 2026-08-01T01:00Z = 2026-07-31 20:00 in America/Chicago (CDT, UTC-5) — still
    // the spring term there, so grade 12 = class of 2026. Read in UTC it is already
    // August (fall) → 2027; the zone param is what prevents that off-by-one.
    const instant = new Date('2026-08-01T01:00:00.000Z');
    expect(gradYearFromGrade(12, instant, 'America/Chicago')).toBe(2026);
    expect(gradYearFromGrade(12, instant, 'UTC')).toBe(2027);
  });
});

describe('Charms/CutTime import presets', () => {
  test('realistic Charms export: colon-split student name, Grade, split adult name, adult contact', () => {
    const csv =
      'Student: Last Name,Student: First Name,Grade,Adult 1 First Name,Adult 1 Last Name,Adult 1 E-mail,Home Phone,Cell Phone\n' +
      'Nguyen,Ava,11,Bly,Nguyen,bly@example.com,555-100-2000,555-100-3000';
    const { rows, errors, skippedColumns } = parseRosterCsv(csv, DEFAULT_SIZE_KEYS, SPRING);
    expect(errors).toHaveLength(0);
    expect(skippedColumns).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      firstName: 'Ava',
      lastName: 'Nguyen',
      gradYear: 2027, // grade 11, spring 2026 → senior 2026 → 11 = 2027
    });
    expect(rows[0].guardians).toHaveLength(1);
    // Split "Adult 1 First/Last Name" concatenated into one guardian name.
    expect(rows[0].guardians[0]).toMatchObject({
      name: 'Bly Nguyen',
      email: 'bly@example.com',
      // Both Home and Cell map to guardian-1 phone; the later column wins.
      phone: '555-100-3000',
    });
  });

  test('two split-name adults become two guardians via Adult N indexing', () => {
    const csv =
      'Student: First Name,Student: Last Name,Adult 1 First Name,Adult 1 Last Name,Adult 1 E-mail,Adult 2 First Name,Adult 2 Last Name,Adult 2 E-mail\n' +
      'Leo,Park,Dana,Park,dana@example.com,Sam,Park,sam@example.com';
    const { rows, errors } = parseRosterCsv(csv, DEFAULT_SIZE_KEYS, FALL);
    expect(errors).toHaveLength(0);
    expect(rows[0].guardians.map((g) => g.name)).toEqual(['Dana Park', 'Sam Park']);
    expect(rows[0].guardians.map((g) => g.email)).toEqual([
      'dana@example.com',
      'sam@example.com',
    ]);
  });

  test('CutTime "Grade" column becomes a grad year, never a 2-digit year', () => {
    // The old grad path would read "12" as the year 2012; the grade path must not.
    const { rows } = parseRosterCsv('First,Last,Grade\nAva,Nguyen,12', DEFAULT_SIZE_KEYS, FALL);
    expect(rows[0].gradYear).toBe(2027);
    expect(rows[0].gradYear).not.toBe(2012);
  });

  test('an out-of-range Grade excludes the row with a grad-year error', () => {
    const { rows, errors } = parseRosterCsv(
      'First,Last,Grade\nAva,Nguyen,7',
      DEFAULT_SIZE_KEYS,
      FALL,
    );
    expect(rows).toHaveLength(0);
    expect(errors[0].message).toMatch(/grad year/i);
  });

  test('bare Adult contact halves alone still form a guardian (no whole-name column)', () => {
    const csv = 'First,Last,Adult 1 First Name,Adult 1 Last Name\nAva,Nguyen,Bly,Nguyen';
    const { rows } = parseRosterCsv(csv, DEFAULT_SIZE_KEYS, FALL);
    expect(rows[0].guardians).toEqual([
      { name: 'Bly Nguyen', email: null, phone: null, relationship: null },
    ]);
  });
});

describe('collision safety (Constitution III + student/guardian mapping)', () => {
  test('"Grade" is NOT caught by any health-keyword filter (not skipped)', () => {
    const { rows, errors, skippedColumns } = parseRosterCsv(
      'First,Last,Grade\nAva,Nguyen,12',
      DEFAULT_SIZE_KEYS,
      FALL,
    );
    expect(skippedColumns).toHaveLength(0);
    expect(errors).toHaveLength(0);
    expect(rows[0].gradYear).toBe(2027);
  });

  test('a real health column alongside Grade is still skipped; Grade survives', () => {
    const csv =
      'First,Last,Grade,Medical Notes\nAva,Nguyen,12,peanut allergy';
    const { rows, skippedColumns } = parseRosterCsv(csv, DEFAULT_SIZE_KEYS, FALL);
    expect(skippedColumns.map((s) => s.header)).toEqual(['Medical Notes']);
    expect(rows[0].gradYear).toBe(2027);
    expect(JSON.stringify(rows[0])).not.toContain('peanut');
  });

  test('adult split-name columns do NOT collide with student first/last', () => {
    // Student First/Last and Adult 1 First/Last coexist in one row — the student
    // identity must come only from the student columns, the guardian only from
    // the adult columns.
    const csv =
      'First Name,Last Name,Adult 1 First Name,Adult 1 Last Name\n' +
      'Ava,Nguyen,Bly,Contreras';
    const { rows, errors } = parseRosterCsv(csv, DEFAULT_SIZE_KEYS, FALL);
    expect(errors).toHaveLength(0);
    expect(rows[0]).toMatchObject({ firstName: 'Ava', lastName: 'Nguyen' });
    expect(rows[0].guardians[0].name).toBe('Bly Contreras');
  });

  test('graduation-year column still works and is not confused with Grade', () => {
    const { rows } = parseRosterCsv(
      'First,Last,Graduation Year\nAva,Nguyen,2028',
      DEFAULT_SIZE_KEYS,
      FALL,
    );
    expect(rows[0].gradYear).toBe(2028);
  });

  test('"Email Address" imports as a guardian email, not dropped as an address column', () => {
    const { rows, skippedColumns, errors } = parseRosterCsv(
      'First,Last,Email Address\nAva,Nguyen,bly@example.com',
    );
    expect(skippedColumns).toHaveLength(0);
    expect(errors).toHaveLength(0);
    expect(rows[0].guardians).toHaveLength(1);
    expect(rows[0].guardians[0].email).toBe('bly@example.com');
  });

  test('"Adult 1 Email Address" and "Parent Email Address" map to guardian emails', () => {
    const adult = parseRosterCsv(
      'First,Last,Adult 1 Email Address\nAva,Nguyen,adult@example.com',
    );
    expect(adult.skippedColumns).toHaveLength(0);
    expect(adult.rows[0].guardians[0].email).toBe('adult@example.com');

    const parent = parseRosterCsv(
      'First,Last,Parent Email Address\nAva,Nguyen,parent@example.com',
    );
    expect(parent.skippedColumns).toHaveLength(0);
    expect(parent.rows[0].guardians[0].email).toBe('parent@example.com');
  });

  test('true mailing-address columns are still dropped whole (Constitution III)', () => {
    for (const header of ['Home Address', 'Address', 'Mailing Address', 'Street Address']) {
      const { skippedColumns, rows } = parseRosterCsv(
        `First,Last,${header}\nAva,Nguyen,123 Main St`,
      );
      expect(skippedColumns.map((s) => s.header)).toContain(header);
      expect(JSON.stringify(rows[0])).not.toContain('123 Main');
    }
  });
});

describe('per-row validation errors', () => {
  test('missing name is excluded and reported', () => {
    const csv = 'First,Last,Grad\n,,2027\nAva,Nguyen,2027';
    const { rows, errors } = parseRosterCsv(csv);
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ row: 1 });
    expect(errors[0].message).toMatch(/name/i);
  });

  test('missing last name only is an error', () => {
    const { rows, errors } = parseRosterCsv('First,Last\nAva,');
    expect(rows).toHaveLength(0);
    expect(errors[0].message).toMatch(/first and last/i);
  });

  test('bad grad year is excluded and reported', () => {
    const { rows, errors } = parseRosterCsv('First,Last,Grad\nAva,Nguyen,twenty');
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/grad year/i);
  });

  test('bad guardian email excludes the row', () => {
    const csv = 'First,Last,Guardian Email\nAva,Nguyen,not-an-email';
    const { rows, errors } = parseRosterCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors[0].message).toMatch(/email/i);
  });

  test('valid rows still commit alongside error rows', () => {
    const csv =
      'First,Last,Grad\n' +
      'Ava,Nguyen,2027\n' +
      ',,2026\n' +
      'Leo,Park,2026';
    const { rows, errors } = parseRosterCsv(csv);
    expect(rows.map((r) => r.firstName)).toEqual(['Ava', 'Leo']);
    expect(errors).toHaveLength(1);
  });
});

// ============================================================================
// One reviewable issue list (spec 005 T137a)
// ----------------------------------------------------------------------------
// The preview used to report in three unrelated shapes — a red box of skipped
// columns, a chip inside a table cell, a bullet list of excluded rows. These
// pin the flattening: what each entry says, and the order a director meets them
// in (data that did not make it first).
// ============================================================================

describe('importIssues', () => {
  test('a clean file has nothing to review', () => {
    const parsed = parseRosterCsv('First,Last,Grad\nAva,Nguyen,2027');
    expect(importIssues(parsed)).toEqual([]);
  });

  test('a health column becomes one blocking entry naming the header', () => {
    const parsed = parseRosterCsv('First,Last,Allergies\nAva,Nguyen,peanuts');
    const issues = importIssues(parsed);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('column');
    expect(issues[0].where).toBe('Allergies');
    expect(issues[0].blocking).toBe(true);
  });

  test('an excluded row names its row number and says what to do', () => {
    const parsed = parseRosterCsv('First,Last,Grad\nAva,Nguyen,2027\n,,2026');
    const issues = importIssues(parsed);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('excluded');
    expect(issues[0].where).toBe('Row 2');
    expect(issues[0].blocking).toBe(true);
    expect(issues[0].fix).toMatch(/spreadsheet/i);
  });

  test('merged rows report as non-blocking and list every source row', () => {
    const csv =
      'First,Last,Grad,Guardian Name\n' +
      'Ava,Nguyen,2027,Mai Nguyen\n' +
      'Ava,Nguyen,2027,Bao Nguyen';
    const parsed = parseRosterCsv(csv);
    const issues = importIssues(parsed);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('combined');
    expect(issues[0].where).toBe('Rows 1, 2');
    expect(issues[0].blocking).toBe(false);
  });

  test('what kept data out sorts above what only needs reading', () => {
    const csv =
      'First,Last,Grad,Medical,Guardian Name\n' +
      'Ava,Nguyen,2027,none,Mai Nguyen\n' +
      'Ava,Nguyen,2027,none,Bao Nguyen\n' +
      ',,2026,none,';
    const issues = importIssues(parseRosterCsv(csv));
    expect(issues.map((i) => i.kind)).toEqual(['excluded', 'column', 'combined']);
    expect(issues.filter((i) => i.blocking)).toHaveLength(2);
  });
});
