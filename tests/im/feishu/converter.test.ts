import { describe, it } from 'bun:test';
import assert from 'node:assert';
import { convertToFeishuCard } from '../../../src/im/feishu/converter';
import type { UniversalCard } from '../../../src/im/types';

describe('Feishu Card Converter', () => {
  it('should convert a simple text card', () => {
    const card: UniversalCard = {
      title: 'Test Card',
      elements: [
        { type: 'markdown', content: 'This is **bold** text' },
        { type: 'text', content: 'Plain text' },
      ],
    };

    const feishuCard = convertToFeishuCard(card);

    assert.strictEqual(feishuCard.config.wide_screen_mode, true);
    assert.strictEqual(feishuCard.header.title.content, 'Test Card');
    assert.strictEqual(feishuCard.elements.length, 2);

    // Check first element
    assert.strictEqual(feishuCard.elements[0].tag, 'div');
    assert.strictEqual(feishuCard.elements[0].text.tag, 'lark_md');
    assert.strictEqual(feishuCard.elements[0].text.content, 'This is **bold** text');

    // Check second element
    assert.strictEqual(feishuCard.elements[1].text.tag, 'plain_text');
    assert.strictEqual(feishuCard.elements[1].text.content, 'Plain text');
  });

  it('should convert a field_group card', () => {
    const card: UniversalCard = {
      title: 'Field Card',
      elements: [
        {
          type: 'field_group',
          fields: [
            { title: 'Project', content: 'baton' },
            { title: 'Status', content: 'Active' },
          ],
        },
      ],
    };

    const feishuCard = convertToFeishuCard(card);
    assert.strictEqual(feishuCard.elements.length, 1);
    assert.strictEqual(feishuCard.elements[0].fields.length, 2);
    assert.strictEqual(feishuCard.elements[0].fields[0].text.content, '**Project**\nbaton');
  });

  it('should convert actions with confirmation', () => {
    const card: UniversalCard = {
      title: 'Action Card',
      elements: [],
      actions: [
        {
          id: 'action_1',
          text: 'Approve',
          style: 'primary',
          value: 'val_1',
          confirm: {
            title: 'Confirm?',
            content: 'Are you sure?',
          },
        },
      ],
    };

    const feishuCard = convertToFeishuCard(card);

    assert.strictEqual(feishuCard.elements.length, 1);
    const actionElement = feishuCard.elements[0];
    assert.strictEqual(actionElement.tag, 'action');
    assert.strictEqual(actionElement.actions.length, 1);

    const button = actionElement.actions[0];
    assert.strictEqual(button.tag, 'button');
    assert.strictEqual(button.text.content, 'Approve');
    assert.strictEqual(button.type, 'primary');
    assert.deepStrictEqual(button.value, { action_id: 'action_1', value: 'val_1' });

    // Check confirm
    assert.ok(button.confirm);
    assert.strictEqual(button.confirm.title.content, 'Confirm?');
    assert.strictEqual(button.confirm.text.content, 'Are you sure?');
  });
});
