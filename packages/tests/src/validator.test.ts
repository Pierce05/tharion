import { describe, expect, it } from 'vitest';
import { hasErrors, validateWorkflow } from '@tharion/engine';
import { cond, def, edge, http, output, transform, trigger } from './helpers';

const codes = (issues: { code: string }[]): string[] => issues.map((i) => i.code);

describe('validator (test 1)', () => {
  it('accepts a valid graph with no issues', async () => {
    const issues = await validateWorkflow(
      def(
        [trigger('t', { amount: 5 }), cond('c', 'amount >= 10'), output('a'), output('b')],
        [edge('t', 'c'), edge('c', 'a', 'true'), edge('c', 'b', 'false')],
      ),
    );
    expect(issues).toEqual([]);
  });

  it('detects cycles', async () => {
    const issues = await validateWorkflow(
      def(
        [trigger('t'), transform('a', '$'), transform('b', '$'), output('o')],
        [edge('t', 'a'), edge('a', 'b'), edge('b', 'a'), edge('b', 'o')],
      ),
    );
    expect(codes(issues)).toContain('CYCLE');
    expect(hasErrors(issues)).toBe(true);
  });

  it('detects unreachable nodes', async () => {
    const issues = await validateWorkflow(
      def([trigger('t'), output('o'), transform('orphan', '$')], [edge('t', 'o')]),
    );
    const bad = issues.find((i) => i.code === 'UNREACHABLE');
    expect(bad?.nodeId).toBe('orphan');
  });

  it('detects edge type mismatch with a human reason', async () => {
    const issues = await validateWorkflow(
      def(
        [trigger('t'), transform('s', '"hello"', 'string'), http('h', 'mock://ok'), output('o')],
        [edge('t', 's'), edge('s', 'h'), edge('h', 'o')],
      ),
    );
    const bad = issues.find((i) => i.code === 'EDGE_TYPE');
    expect(bad?.severity).toBe('error');
    expect(bad?.edgeId).toBe('s:out->h');
    expect(bad?.message).toMatch(/string/);
    expect(bad?.message).toMatch(/object/);
  });

  it('detects invalid JSONata in transform, condition and templates', async () => {
    const issues = await validateWorkflow(
      def(
        [trigger('t'), transform('x', 'a +'), cond('c', 'a >='), output('o')],
        [edge('t', 'x'), edge('x', 'c'), edge('c', 'o', 'true')],
      ),
    );
    expect(codes(issues)).toContain('JSONATA_PARSE');
    expect(codes(issues)).toContain('COND_PARSE');
  });

  it('detects a missing trigger', async () => {
    const issues = await validateWorkflow(def([transform('x', '$'), output('o')], [edge('x', 'o')]));
    expect(codes(issues)).toContain('NO_TRIGGER');
  });

  it('rejects inbound edges on a trigger and bad handles', async () => {
    const issues = await validateWorkflow(
      def(
        [trigger('t'), transform('x', '$'), output('o')],
        [edge('t', 'x'), edge('x', 't'), edge('x', 'o', 'true')],
      ),
    );
    expect(codes(issues)).toContain('TRIGGER_INBOUND');
    expect(codes(issues)).toContain('EDGE_BAD_HANDLE');
  });

  it('requires conditions to return boolean on sample data', async () => {
    const issues = await validateWorkflow(
      def([trigger('t', { n: 5 }), cond('c', 'n + 1'), output('o')], [edge('t', 'c'), edge('c', 'o', 'true')]),
    );
    expect(codes(issues)).toContain('COND_NOT_BOOLEAN');
  });

  it('warnings do not block execution', async () => {
    const issues = await validateWorkflow(def([trigger('t'), transform('x', '$')], [edge('t', 'x')]));
    expect(codes(issues)).toContain('NO_OUTPUT');
    expect(codes(issues)).toContain('ORPHAN_OUTPUT');
    expect(hasErrors(issues)).toBe(false);
  });
});