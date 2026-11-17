// @vitest-environment jsdom
/**
 * Instructor controls panel: the preset selector, the settings, canonical
 * preset protection, the duration estimate and the shareable links.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeSettings } from '../core/custom';
import { CUSTOM_WARNING, Instructor } from './Instructor';

afterEach(cleanup);

const base = `${window.location.origin}/`;

function openPanel() {
  const view = render(<Instructor />);
  fireEvent.click(screen.getByRole('button', { name: /I am an instructor/ }));
  return view;
}

const presetSelect = () => screen.getByLabelText('Preset') as HTMLSelectElement;
const optionNames = () => [...presetSelect().options].map((o) => o.textContent);
const protocolId = () => screen.getByTestId('protocol-id').textContent;
const linkValue = (title: string) => (screen.getByLabelText(`${title} address`) as HTMLInputElement).value;
const linkTitles = () => [...document.querySelectorAll('.link-row-text strong')].map((el) => el.textContent);
const choose = (label: string | RegExp) => fireEvent.click(screen.getByLabelText(label));

describe('the gate', () => {
  it('keeps the design behind a confirmation, with a way back to the activity', () => {
    const { container } = render(<Instructor />);
    expect(container.textContent).not.toMatch(/\b45\b|k7m2|p4x9|rotation-sudden|Rotation angle/);
    expect(screen.getByRole('link', { name: 'Back to the activity' }).getAttribute('href')).toBe('/');
  });
});

describe('preset selector', () => {
  it('offers the three shipped presets and starts on Sudden 45°', () => {
    openPanel();
    expect(optionNames()).toEqual(['Sudden 45°', 'Gradual 0°→45°', 'Quick Demo']);
    expect(presetSelect().value).toBe('sudden');
    expect(protocolId()).toBe('rotation-sudden-45-v3');
    expect(screen.queryByTestId('custom-warning')).toBeNull();
  });

  it('choosing a preset sets every setting to that preset’s defaults', () => {
    openPanel();
    fireEvent.change(presetSelect(), { target: { value: 'gradual' } });
    expect(protocolId()).toBe('rotation-gradual-45-v3');
    expect((screen.getByLabelText(/^Gradual \(ramps/) as HTMLInputElement).checked).toBe(true);

    fireEvent.change(presetSelect(), { target: { value: 'quick-demo' } });
    expect(protocolId()).toBe('rotation-quickdemo-45-v3');
    expect((screen.getByLabelText('Quick (16 trials)') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/^Sudden \(all/) as HTMLInputElement).checked).toBe(true);
  });

  it('shows the defaults of the settings table', () => {
    openPanel();
    expect((screen.getByLabelText('45°') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Standard (40 trials)') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Hidden cursor') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Catch trials') as HTMLInputElement).checked).toBe(true);
    for (const label of ['15°', '30°', '60°', 'Quick (16 trials)', 'Extended (64 trials)', 'Visible cursor']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });
});

describe('canonical preset protection', () => {
  it('“Custom” appears only after a setting is changed from a canonical default', () => {
    openPanel();
    expect(optionNames()).not.toContain('Custom');
    choose('30°');
    expect(optionNames()).toEqual(['Sudden 45°', 'Gradual 0°→45°', 'Quick Demo', 'Custom']);
    expect(presetSelect().value).toBe('custom');
  });

  it('a changed setting gets a new custom id and the pooling warning; the canonical id is not reused', () => {
    openPanel();
    choose('30°');
    expect(protocolId()).toBe('rotation-sudden-30-custom-v3');
    const warning = screen.getByTestId('custom-warning');
    expect(warning.textContent).toContain(CUSTOM_WARNING);
    expect(warning.textContent).toContain(
      'Custom sessions will not be pooled with canonical preset data in class comparisons.',
    );
  });

  it('every single departure from the canonical defaults is custom', () => {
    const changes: Array<[string | RegExp, string]> = [
      ['15°', 'rotation-sudden-15-custom-v3'],
      ['60°', 'rotation-sudden-60-custom-v3'],
      ['Extended (64 trials)', 'rotation-sudden-45-custom-extended-v3'],
      ['Visible cursor', 'rotation-sudden-45-custom-aevisible-v3'],
      ['Catch trials', 'rotation-sudden-45-custom-nocatch-v3'],
    ];
    for (const [label, id] of changes) {
      openPanel();
      choose(label);
      expect(protocolId()).toBe(id);
      expect(presetSelect().value).toBe('custom');
      expect(screen.getByTestId('custom-warning')).toBeTruthy();
      cleanup();
    }
  });

  it('putting the setting back returns to the canonical preset and drops the Custom option', () => {
    openPanel();
    choose('30°');
    choose('45°');
    expect(protocolId()).toBe('rotation-sudden-45-v3');
    expect(presetSelect().value).toBe('sudden');
    expect(optionNames()).not.toContain('Custom');
    expect(screen.queryByTestId('custom-warning')).toBeNull();
  });

  it('switching schedule between the two canonical presets stays canonical', () => {
    openPanel();
    choose(/^Gradual \(ramps/);
    expect(protocolId()).toBe('rotation-gradual-45-v3');
    expect(presetSelect().value).toBe('gradual');
    expect(screen.queryByTestId('custom-warning')).toBeNull();
  });

  it('the canonical links never change, whatever the settings say', () => {
    openPanel();
    const canonical = () => [linkValue('Random assignment link'), linkValue('Sudden 45° link'), linkValue('Gradual 0°→45° link')];
    const before = canonical();
    expect(before).toEqual([base, `${base}?c=k7m2`, `${base}?c=p4x9`]);
    choose('60°');
    choose('Extended (64 trials)');
    choose('Visible cursor');
    choose('Catch trials');
    choose(/^Gradual \(ramps/);
    expect(protocolId()).toBe('rotation-gradual-60-custom-extended-aevisible-nocatch-v3');
    expect(canonical()).toEqual(before);
  });
});

describe('live duration estimate', () => {
  const estimate = () => screen.getByTestId('duration-estimate').textContent;

  it('updates as the trial count changes', () => {
    openPanel();
    expect(estimate()).toBe('About 5 minutes for a student to complete'); // (40 × 4 + 90 + 30) / 60 = 4.7
    choose('Quick (16 trials)');
    expect(estimate()).toBe('About 3 minutes for a student to complete'); // 184 s
    choose('Extended (64 trials)');
    expect(estimate()).toBe('About 6 minutes for a student to complete'); // 376 s
  });

  it('describes the blocks behind the number', () => {
    openPanel();
    const summary = document.querySelector('.setting-summary')?.textContent ?? '';
    expect(summary).toContain('40 recorded reaches (8 baseline · 24 rotation block (2 catch trials) · 8 aftereffect)');
    choose('Extended (64 trials)');
    expect(document.querySelector('.setting-summary')?.textContent).toContain(
      '64 recorded reaches (8 baseline · 48 rotation block (3 catch trials) · 8 aftereffect)',
    );
    choose('Catch trials');
    expect(document.querySelector('.setting-summary')?.textContent).toContain('48 rotation block (no catch trials)');
  });
});

describe('shareable links', () => {
  it('shows the three canonical links, each with a copy button', () => {
    openPanel();
    expect(linkTitles()).toEqual(['Random assignment link', 'Sudden 45° link', 'Gradual 0°→45° link']);
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Copy custom link' })).toBeNull();
  });

  it('adds a single “Copy custom link” for a custom configuration, encoding the settings in the address', () => {
    openPanel();
    choose('30°');
    choose('Visible cursor');
    expect(linkTitles()).toEqual(['Random assignment link', 'Sudden 45° link', 'Gradual 0°→45° link', 'Custom link']);
    expect(screen.getAllByRole('button', { name: 'Copy custom link' })).toHaveLength(1);

    const url = new URL(linkValue('Custom link'));
    expect(url.origin + url.pathname).toBe(base);
    expect([...url.searchParams.keys()]).toEqual(['x']);
    expect(decodeSettings(url.searchParams.get('x')!)).toEqual({
      schedule: 'sudden',
      angleDeg: 30,
      tier: 'standard',
      aftereffect: 'visible',
      catchTrials: true,
    });
    // The address itself gives nothing away to the student who opens it.
    expect(url.search).not.toMatch(/sudden|gradual|visible|angle|30/i);
  });

  it('the custom link follows the settings', () => {
    openPanel();
    choose('30°');
    const first = linkValue('Custom link');
    choose('60°');
    expect(linkValue('Custom link')).not.toBe(first);
  });

  it('offers the Quick Demo link when the Quick Demo is selected', () => {
    openPanel();
    fireEvent.change(presetSelect(), { target: { value: 'quick-demo' } });
    expect(linkTitles()).toEqual(['Random assignment link', 'Sudden 45° link', 'Gradual 0°→45° link', 'Quick Demo link']);
    expect(linkValue('Quick Demo link')).toBe(`${base}?c=demo`);
  });

  it('copies a link to the clipboard', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (text: string) => (written.push(text), Promise.resolve()) },
    });
    openPanel();
    const row = screen.getByLabelText('Sudden 45° link address').closest('.link-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Copy' }));
    expect(written).toEqual([`${base}?c=k7m2`]);
    expect(await within(row).findByRole('button', { name: 'Copied' })).toBeTruthy();
  });
});

describe('reference details', () => {
  it('defines the standard presets, the short version and, when one is selected, the custom protocol', () => {
    openPanel();
    const reference = document.querySelector('details.reference') as HTMLElement;
    expect(reference.textContent).toContain('rotation-sudden-45-v3');
    expect(reference.textContent).toContain('rotation-gradual-45-v3');
    expect(reference.textContent).toContain('rotation-quickdemo-45-v3');
    expect(reference.textContent).toMatch(/6\.43°/); // the gradual ramp step is spelled out
    expect(reference.textContent).not.toContain('The protocol selected above');

    choose('30°');
    choose('Catch trials');
    expect(reference.textContent).toContain('The protocol selected above');
    expect(reference.textContent).toContain('Custom: sudden 30° rotation');
    expect(reference.textContent).toContain('rotation-sudden-30-custom-nocatch-v3');
  });

  it('explains how a reach registers and that nothing is measured after arrival', () => {
    openPanel();
    const text = document.querySelector('details.reference')?.textContent ?? '';
    expect(text).toContain('holds on the target for 400 ms');
    expect(text).toContain('in any direction');
    expect(text).toContain('the cursor jumps straight back to the center');
    expect(text).toContain('first arrival at 222 units from the center');
    expect(screen.getByTestId('speed-rule').textContent).toContain('takes longer than 500 ms, “Too slow” appears');
  });
});

describe('class view set-up', () => {
  const classField = () => screen.getByLabelText('Class code') as HTMLInputElement;

  it('asks for a code and offers nothing to open until there is one', () => {
    openPanel();
    expect(classField().value).toBe('');
    expect(screen.queryByTestId('open-class-view')).toBeNull();
    expect(linkTitles()).not.toContain('Class view');
  });

  it('turns a typed code into the class view address, in capitals', () => {
    openPanel();
    fireEvent.change(classField(), { target: { value: 'neuro451' } });
    expect(linkValue('Class view')).toBe(`${window.location.origin}/class/NEURO451`);
    const open = screen.getByTestId('open-class-view') as HTMLAnchorElement;
    expect(open.getAttribute('href')).toBe('/class/NEURO451');
    expect(open.textContent).toContain('NEURO451');
    expect(screen.queryByTestId('class-code-invalid')).toBeNull();
  });

  it('explains what a class code may contain when the typed one will not do', () => {
    openPanel();
    fireEvent.change(classField(), { target: { value: 'NEURO 451' } });
    expect(screen.getByTestId('class-code-invalid').textContent).toContain('letters and digits only');
    expect(screen.queryByTestId('open-class-view')).toBeNull();
  });

  it('says what students share, that it is opt-in, and that the code is not a password', () => {
    openPanel();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Class sharing is opt-in');
    expect(text).toContain('No name, no movement traces, no free-text answers');
    expect(text).toContain('A class code is not a password');
  });
});
