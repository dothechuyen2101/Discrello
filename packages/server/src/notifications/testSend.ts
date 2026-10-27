import {
  allowedMentionsFor,
  formatMentions,
  renderTemplate,
  sampleTemplateVars,
  type MentionTarget,
  type TemplateVars,
  type TestSendResultDto,
} from '@discrello/shared';
import type { DiscordClient } from '../discord/client';
import { verifyMentions } from './verifyMention';

export interface TestSendInput {
  channelId: string;
  /** Everyone to ping: one target, or every member of a team. */
  targets: MentionTarget[];
  template: string;
  vars?: TemplateVars;
}

/** Sends a real message with sample data and reports whether the mention registered. Never throws. */
export async function sendTestMessage(
  discord: DiscordClient,
  input: TestSendInput,
): Promise<TestSendResultDto> {
  const vars = sampleTemplateVars({
    ...input.vars,
    mention: formatMentions(input.targets),
  });
  const content = `${renderTemplate(input.template, vars)}\n-# Test message from Discrello`;
  try {
    const message = await discord.sendMessage(input.channelId, {
      content,
      allowedMentions: allowedMentionsFor(input.targets),
    });
    const { verified, missed } = verifyMentions(message, input.targets);
    return {
      ok: verified !== false,
      messageId: message.id,
      mentionVerified: verified ?? undefined,
      content,
      ...(verified === false
        ? {
            error:
              missed.length === input.targets.length
                ? 'Message posted but Discord did not register the mention — nobody was notified.'
                : `Message posted but Discord did not register ${missed.length} of the ${input.targets.length} mentions — those were not notified.`,
          }
        : {}),
    };
  } catch (err) {
    return { ok: false, content, error: err instanceof Error ? err.message : String(err) };
  }
}
