// ============================================================================
// Unit tests — roster vocabulary + anchors (spec 005 Wave 6)
// ----------------------------------------------------------------------------
// Pure helpers only; no DB, no globalSetup (runs under vitest.unit.config.ts).
//
// These are small on purpose and load-bearing anyway: the anchor builders are
// what let a refused write reopen the row that produced it (three modules build
// the same string, so it is built once), and the two allow-lists are what stop a
// hand-typed `?section=` or a posted `role` from reaching a redirect or an
// insert. Deliverability labels are covered because "bounced" is jargon the
// student page and the email-issues list must not disagree about.
// ============================================================================

import { describe, test, expect } from 'vitest';
import {
  STUDENT_STATUSES,
  STUDENT_STATUS_LABELS,
  STUDENT_SECTIONS,
  GUARDIAN_EMAIL_STATUSES,
  GUARDIAN_EMAIL_STATUS_LABELS,
  isStudentSection,
  guardianAnchor,
} from '@/lib/roster/students';
import {
  MEMBER_ROLES,
  MEMBER_ROLE_LABELS,
  isMemberRole,
  ensembleAnchor,
  memberAnchor,
} from '@/lib/roster/ensembles';

describe('student vocabulary', () => {
  test('every stored status has a label', () => {
    for (const s of STUDENT_STATUSES) {
      expect(STUDENT_STATUS_LABELS[s]).toBeTruthy();
    }
  });

  test('the four groups of the student page are exactly the spec order', () => {
    expect([...STUDENT_SECTIONS]).toEqual([
      'profile',
      'sizes',
      'guardians',
      'status',
    ]);
  });

  test('isStudentSection accepts only the four, never a prototype walk', () => {
    for (const s of STUDENT_SECTIONS) expect(isStudentSection(s)).toBe(true);
    expect(isStudentSection('constructor')).toBe(false);
    expect(isStudentSection('__proto__')).toBe(false);
    expect(isStudentSection('')).toBe(false);
    expect(isStudentSection('guardians ')).toBe(false);
  });
});

describe('guardian deliverability', () => {
  test('every stored email_status has a plain-language label', () => {
    for (const s of GUARDIAN_EMAIL_STATUSES) {
      expect(GUARDIAN_EMAIL_STATUS_LABELS[s]).toBeTruthy();
    }
  });

  test('the labels say what happened, not what the column says', () => {
    expect(GUARDIAN_EMAIL_STATUS_LABELS.ok).toBe('Delivering');
    expect(GUARDIAN_EMAIL_STATUS_LABELS.bounced).toBe('Bouncing');
  });
});

describe('row anchors', () => {
  test('a guardian row, its reopen link, and the email-issues fix all agree', () => {
    expect(guardianAnchor('abc-123')).toBe('guardian-abc-123');
  });

  test('ensembles and placements get their own prefixes', () => {
    expect(ensembleAnchor('e1')).toBe('ensemble-e1');
    expect(memberAnchor('m1')).toBe('member-m1');
  });
});

describe('ensemble membership vocabulary', () => {
  test('every role has a label', () => {
    for (const r of MEMBER_ROLES) {
      expect(MEMBER_ROLE_LABELS[r]).toBeTruthy();
    }
  });

  test('isMemberRole refuses anything not on the list', () => {
    for (const r of MEMBER_ROLES) expect(isMemberRole(r)).toBe(true);
    expect(isMemberRole('director')).toBe(false);
    expect(isMemberRole('constructor')).toBe(false);
    expect(isMemberRole('')).toBe(false);
  });
});
