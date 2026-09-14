import { describe, it, expect } from 'vitest';
import { roleEnum } from '../shared/schema.js';

describe('Role Enum', () => {
  it('includes all four canonical roles', () => {
    const enumValues = roleEnum.enumValues;
    expect(enumValues).toContain('student');
    expect(enumValues).toContain('coach');
    expect(enumValues).toContain('staff');
    expect(enumValues).toContain('admin');
  });

  it('has exactly four roles', () => {
    expect(roleEnum.enumValues).toHaveLength(4);
  });
});
