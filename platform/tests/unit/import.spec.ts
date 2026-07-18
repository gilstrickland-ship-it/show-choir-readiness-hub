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
  DEFAULT_SIZE_KEYS,
} from '@/lib/roster/import';

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
