import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { parseFilter } from '../controllers/remediation.controller.js';
import { renderFixPackMarkdown, toFixPackJson } from './fix-pack.js';

const project = { id: 'project-1', name: 'Acme', domain: 'acme.test' };
const base = {
  id: 'fix-1',
  problemKey: 'robots.missing',
  target: 'https://acme.test',
  fixClass: 'CONFIG',
  method: 'GENERATED',
  groupKey: 'robots',
  severity: 'MEDIUM',
  effort: 'LOW',
  status: 'OPEN',
  title: 'Publish a robots.txt',
  evidence: {},
  artifact: { kind: 'file', path: '/robots.txt', language: 'text', content: 'User-agent: *\nAllow: /\n' },
  artifactError: null,
  steps: ['Save it.', 'Deploy.'],
  acceptance: { kind: 'robots-exists' },
  llmDraft: null,
  needsClientDecision: false,
  decision: null,
};

describe('fix pack', () => {
  it('JSON carries everything an agent needs, including the acceptance check', () => {
    const pack = toFixPackJson(project, [base]);
    expect(pack.fixes[0]).toMatchObject({ id: 'fix-1', artifact: { path: '/robots.txt' }, acceptance: { kind: 'robots-exists' }, awaitingClientDecision: false });
  });

  it('Markdown renders steps, the ready-made file and the done-when line', () => {
    const md = renderFixPackMarkdown(toFixPackJson(project, [base, { ...base, id: 'fix-2', title: 'Decide', artifact: null, artifactError: 'no input', needsClientDecision: true }]));
    expect(md).toContain('# Fix Plan — Acme (acme.test)');
    expect(md).toContain('1. Save it.');
    expect(md).toContain('```\nUser-agent: *\nAllow: /\n```');
    expect(md).toContain('**Done when:** /robots.txt loads with HTTP 200.');
    expect(md).toContain("needs the client's decision first");
    expect(md).toContain('> no input');
  });
});

describe('parseFilter', () => {
  it('parses comma-separated statuses case-insensitively', () => {
    expect(parseFilter('open,regressed', 'code', 'robots', 'high')).toEqual({ status: ['OPEN', 'REGRESSED'], fixClass: 'CODE', groupKey: 'robots', severity: 'HIGH' });
  });

  it('400s on unknown values instead of silently ignoring them', () => {
    expect(() => parseFilter('DONE')).toThrow(BadRequestException);
    expect(() => parseFilter(undefined, 'magic')).toThrow(BadRequestException);
  });
});
