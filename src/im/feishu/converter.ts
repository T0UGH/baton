import type { UniversalCard, CardElement, CardAction } from '../types';

/**
 * 将通用卡片转换为飞书交互式卡片格式
 * 文档: https://open.feishu.cn/document/ukTMukTMukTM/uEjNwYjLxYDM24SM2AjN
 */
export function convertToFeishuCard(card: UniversalCard): any {
  const feishuCard = {
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: card.title,
      },
      template: 'blue', // 默认使用蓝色标题
    },
    elements: [] as any[],
  };

  // 转换内容元素
  for (const element of card.elements) {
    const feishuElement = convertElement(element);
    if (feishuElement) {
      feishuCard.elements.push(feishuElement);
    }
  }

  // 转换操作按钮
  if (card.actions && card.actions.length > 0) {
    const actionElement = {
      tag: 'action',
      actions: card.actions.map(convertAction),
    };
    feishuCard.elements.push(actionElement);
  }

  return feishuCard;
}

function convertElement(element: CardElement): any {
  switch (element.type) {
    case 'markdown':
      return {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: element.content,
        },
      };
    
    case 'text':
      return {
        tag: 'div',
        text: {
          tag: 'plain_text',
          content: element.content,
        },
      };

    case 'field_group':
      return {
        tag: 'div',
        fields: element.fields.map(field => ({
          is_short: true, // 默认都展示为短字段
          text: {
            tag: 'lark_md',
            content: `**${field.title}**
${field.content}`,
          },
        })),
      };

    default:
      return null;
  }
}

function convertAction(action: CardAction): any {
  const button: any = {
    tag: 'button',
    text: {
      tag: 'plain_text',
      content: action.text,
    },
    type: mapButtonStyle(action.style),
    value: {
      action_id: action.id, // 飞书回传的 action_id (注意：飞书通常放在 value 字典里)
      value: action.value,  // 实际数据
    },
  };

  if (action.confirm) {
    button.confirm = {
      title: {
        tag: 'plain_text',
        content: action.confirm.title,
      },
      text: {
        tag: 'plain_text',
        content: action.confirm.content,
      },
    };
  }

  return button;
}

function mapButtonStyle(style: CardAction['style']): string {
  switch (style) {
    case 'primary':
      return 'primary';
    case 'danger':
      return 'danger';
    case 'default':
    default:
      return 'default';
  }
}
