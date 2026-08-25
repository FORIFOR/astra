import { describe, expect, it } from 'vitest';
import { OPAQUE_KEYS, toCamel, toSnake } from '../src/codec.js';

describe('codec', () => {
  it('converts keys in both directions', () => {
    const wire = { task_id: '1', result_artifact_id: null, created_at: 'x' };
    const app = toCamel<Record<string, unknown>>(wire);
    expect(Object.keys(app)).toEqual(['taskId', 'resultArtifactId', 'createdAt']);
    expect(toSnake(app)).toEqual(wire);
  });

  it('round-trips nested structures', () => {
    const wire = {
      stream_kind: 'task',
      items: [
        { step_index: 0, tool_id: 'a' },
        { step_index: 1, tool_id: 'b' },
      ],
      nested: { deep_value: { deeper_value: 1 } },
    };
    expect(toSnake(toCamel(wire))).toEqual(wire);
  });

  it('never rewrites keys inside opaque regions', () => {
    // task.input はユーザー由来の任意 JSON。ここを変換すると値が壊れる。
    const wire = {
      task_id: '1',
      input: { user_key: 1, AnotherKey: 2, 'kebab-key': 3, nested: { snake_case: 4 } },
      payload: { raw_thing: true },
    };
    const app = toCamel<{ taskId: string; input: Record<string, unknown>; payload: unknown }>(wire);
    expect(app.taskId).toBe('1');
    expect(app.input).toEqual(wire.input);
    expect(app.payload).toEqual(wire.payload);
    expect(toSnake(app)).toEqual(wire);
  });

  it('detaches opaque values from the source object', () => {
    const wire = { input: { a: { b: 1 } } };
    const app = toCamel<{ input: { a: { b: number } } }>(wire);
    app.input.a.b = 99;
    expect(wire.input.a.b).toBe(1);
  });

  it('accepts extra opaque keys', () => {
    const wire = { extra_blob: { keep_me: 1 } };
    const app = toCamel<{ extraBlob: Record<string, unknown> }>(wire, {
      opaqueKeys: ['extra_blob'],
    });
    expect(app.extraBlob).toEqual({ keep_me: 1 });
  });

  it('declares input and payload as opaque', () => {
    expect(OPAQUE_KEYS).toContain('input');
    expect(OPAQUE_KEYS).toContain('payload');
    expect(OPAQUE_KEYS).toContain('manifest');
  });

  it('passes through primitives and nulls', () => {
    expect(toCamel(null)).toBeNull();
    expect(toCamel(3)).toBe(3);
    expect(toCamel([1, 'a', null])).toEqual([1, 'a', null]);
  });
});
