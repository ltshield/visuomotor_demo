import { describe, expect, it } from 'vitest';
import { INSTRUCTOR_PATH, classPath, parseRoute } from './route';

describe('parseRoute', () => {
  it('treats the root, with or without link codes, as the student activity', () => {
    expect(parseRoute('/', '')).toEqual({ name: 'home' });
    expect(parseRoute('', '')).toEqual({ name: 'home' });
    expect(parseRoute('/index.html', '')).toEqual({ name: 'home' });
    expect(parseRoute('/', '#')).toEqual({ name: 'home' });
    expect(parseRoute('/', '#/')).toEqual({ name: 'home' });
  });

  it('finds the instructor panel at /instructor', () => {
    expect(parseRoute('/instructor', '')).toEqual({ name: 'instructor' });
    expect(parseRoute('/instructor/', '')).toEqual({ name: 'instructor' });
    expect(parseRoute(INSTRUCTOR_PATH, '')).toEqual({ name: 'instructor' });
  });

  it('still honours the hash address printed for the first release', () => {
    expect(parseRoute('/', '#/instructors')).toEqual({ name: 'instructor' });
    expect(parseRoute('/', '#/instructor')).toEqual({ name: 'instructor' });
    expect(parseRoute('/', '#instructors')).toEqual({ name: 'instructor' });
  });

  it('finds the class view and its code', () => {
    expect(parseRoute('/class/NEURO451', '')).toEqual({ name: 'class', code: 'NEURO451' });
    expect(parseRoute('/class/neuro451/', '')).toEqual({ name: 'class', code: 'neuro451' });
    expect(parseRoute('/', '#/class/NEURO451')).toEqual({ name: 'class', code: 'NEURO451' });
    expect(parseRoute(classPath('NEURO451'), '')).toEqual({ name: 'class', code: 'NEURO451' });
  });

  it('passes an odd code through for the class page to reject, rather than guessing', () => {
    expect(parseRoute('/class/has%20space', '')).toEqual({ name: 'class', code: 'has space' });
    expect(parseRoute('/class/%E0%A4%A', '')).toEqual({ name: 'class', code: '%E0%A4%A' });
  });

  it('does not mistake other paths for a page', () => {
    expect(parseRoute('/class', '')).toEqual({ name: 'home' });
    expect(parseRoute('/class/a/b', '')).toEqual({ name: 'home' });
    expect(parseRoute('/instructor/extra', '')).toEqual({ name: 'home' });
    expect(parseRoute('/somewhere-else', '')).toEqual({ name: 'home' });
  });
});
