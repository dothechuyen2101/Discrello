/**
 * Message template rendering. Shared by the server (real sends) and the UI (live preview)
 * so that what the preview shows is exactly what gets posted.
 */
export const TEMPLATE_VARIABLES = [
  'mention',
  'card_title',
  'card_url',
  'list_name',
  'previous_list_name',
  'board_name',
  'moved_by',
  'commented_by',
  'comment_text',
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateVars = Partial<Record<TemplateVariable, string>>;

/** Which kind of message a template is for: a card moved into a list, or a revision comment. */
export type TemplateKind = 'move' | 'comment';

/** The variables that have a value for each kind; the others render as an empty string. */
export const TEMPLATE_VARIABLES_BY_KIND: Record<TemplateKind, readonly TemplateVariable[]> = {
  move: [
    'mention',
    'card_title',
    'card_url',
    'list_name',
    'previous_list_name',
    'board_name',
    'moved_by',
  ],
  comment: [
    'mention',
    'card_title',
    'card_url',
    'list_name',
    'board_name',
    'commented_by',
    'comment_text',
  ],
};

export const TEMPLATE_VARIABLE_DESCRIPTIONS: Record<TemplateVariable, string> = {
  mention:
    "Who this list pings: the role's target (<@user> or <@&role>), or every member of a team",
  card_title: 'Trello card title',
  card_url: 'Link to the Trello card',
  list_name: 'Name of the list the card entered',
  previous_list_name: 'Name of the list the card came from (empty when unknown)',
  board_name: 'Trello board name',
  moved_by: 'Full name of the Trello member who moved the card',
  commented_by: 'Full name of the Trello member who wrote the revision comment',
  comment_text: 'The revision comment, without the "comment:" prefix',
};

export const DEFAULT_GLOBAL_TEMPLATE = '{mention} — {card_title} is ready for {list_name}';
export const DEFAULT_COMMENT_TEMPLATE =
  '{mention} — feedback added for {card_title} by {commented_by}: {comment_text}';

/** Discord hard limit for message content. */
export const DISCORD_CONTENT_LIMIT = 2000;

const VARIABLE_PATTERN = /\{([a-z_]+)\}/g;

function isKnownVariable(name: string): name is TemplateVariable {
  return (TEMPLATE_VARIABLES as readonly string[]).includes(name);
}

/**
 * Replace `{variable}` placeholders. Known variables that are missing render as an empty
 * string; unknown placeholders are left untouched so the author can see the typo.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(VARIABLE_PATTERN, (match, name: string) => {
    if (isKnownVariable(name)) {
      return vars[name] ?? '';
    }
    return match;
  });
}

/** Placeholders that are not in TEMPLATE_VARIABLES (likely typos). */
export function findUnknownVariables(template: string): string[] {
  const unknown = new Set<string>();
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const name = match[1]!;
    if (!isKnownVariable(name)) unknown.add(name);
  }
  return [...unknown];
}

/** Known placeholders that have no value for this kind of message (e.g. {moved_by} on a comment). */
export function findUnavailableVariables(template: string, kind: TemplateKind): string[] {
  const available: readonly string[] = TEMPLATE_VARIABLES_BY_KIND[kind];
  const unavailable = new Set<string>();
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const name = match[1]!;
    if (isKnownVariable(name) && !available.includes(name)) unavailable.add(name);
  }
  return [...unavailable];
}

export function templateHasMention(template: string): boolean {
  return /\{mention\}/.test(template);
}

/** Sample values used by the UI preview and the "send test" endpoints. */
export function sampleTemplateVars(overrides: TemplateVars = {}): Required<TemplateVars> {
  return {
    mention: '@someone',
    card_title: 'Example card',
    card_url: 'https://trello.com/c/abcd1234',
    list_name: 'Example list',
    previous_list_name: 'Previous list',
    board_name: 'Example board',
    moved_by: 'Jane Doe',
    commented_by: 'Jane Doe',
    comment_text: 'Please tighten the intro and fix the score in the title.',
    ...overrides,
  };
}
