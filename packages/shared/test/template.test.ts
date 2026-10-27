import { describe, expect, it } from 'vitest';
import {
  findUnavailableVariables,
  findUnknownVariables,
  renderTemplate,
  sampleTemplateVars,
  templateHasMention,
} from '../src/template';

describe('renderTemplate', () => {
  it('substitutes every known variable', () => {
    const out = renderTemplate(
      '{mention} — {card_title} is ready for {list_name} ({card_url}) from {previous_list_name} on {board_name} by {moved_by}',
      {
        mention: '<@1>',
        card_title: 'Card',
        list_name: 'Editing',
        card_url: 'https://trello.com/c/x',
        previous_list_name: 'Script',
        board_name: 'SPORTS',
        moved_by: 'Jane',
      },
    );
    expect(out).toBe(
      '<@1> — Card is ready for Editing (https://trello.com/c/x) from Script on SPORTS by Jane',
    );
  });

  it('renders missing known variables as empty and leaves unknown ones literal', () => {
    expect(renderTemplate('{mention}|{previous_list_name}|{nope}', { mention: 'x' })).toBe(
      'x||{nope}',
    );
  });

  it('handles an empty template', () => {
    expect(renderTemplate('', sampleTemplateVars())).toBe('');
  });

  it('does not touch braces that are not placeholders', () => {
    expect(renderTemplate('{ mention } {MENTION} {}', { mention: 'x' })).toBe(
      '{ mention } {MENTION} {}',
    );
  });
});

describe('findUnknownVariables', () => {
  it('reports unknown placeholders once', () => {
    expect(findUnknownVariables('{mention} {foo} {foo} {card_title} {bar}')).toEqual([
      'foo',
      'bar',
    ]);
  });
  it('returns an empty list for a valid template', () => {
    expect(findUnknownVariables('{mention} — {card_title}')).toEqual([]);
  });
});

describe('findUnavailableVariables', () => {
  it('reports known variables that have no value for this kind of message', () => {
    expect(findUnavailableVariables('{mention} {comment_text} {moved_by} {foo}', 'move')).toEqual([
      'comment_text',
    ]);
    expect(
      findUnavailableVariables(
        '{mention} {comment_text} {moved_by} {previous_list_name}',
        'comment',
      ),
    ).toEqual(['moved_by', 'previous_list_name']);
    expect(findUnavailableVariables('{mention} {card_title} {list_name}', 'comment')).toEqual([]);
  });
});

describe('templateHasMention', () => {
  it('detects the mention placeholder', () => {
    expect(templateHasMention('{mention} hi')).toBe(true);
    expect(templateHasMention('hi')).toBe(false);
  });
});
