// Translate Nex's Anthropic-shaped tool loop to the OpenAI-compatible API
// served by vLLM on the private RunPod pod. The rest of Nex keeps its exact
// tool registry, approval gates, memory, and execution loop; only the model
// transport changes.

function textFromSystem(system) {
  if (typeof system === 'string') return system;
  if (!Array.isArray(system)) return '';
  return system
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n\n');
}

function openAIContent(blocks) {
  if (typeof blocks === 'string') return blocks;
  if (!Array.isArray(blocks)) return '';
  const content = [];
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      content.push({ type: 'text', text: block.text });
    } else if (block?.type === 'image' && block.source?.type === 'base64') {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
      });
    }
  }
  if (!content.length) return '';
  return content.length === 1 && content[0].type === 'text' ? content[0].text : content;
}

function toolArguments(input) {
  try { return JSON.stringify(input ?? {}); } catch { return '{}'; }
}

function convertMessage(message) {
  const blocks = Array.isArray(message?.content) ? message.content : null;
  if (!blocks) return [{ role: message.role === 'assistant' ? 'assistant' : 'user', content: String(message?.content || '') }];

  if (message.role === 'assistant') {
    const toolCalls = blocks
      .filter((block) => block?.type === 'tool_use' && block.id && block.name)
      .map((block) => ({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: toolArguments(block.input) },
      }));
    return [{
      role: 'assistant',
      content: blocks.filter((block) => block?.type !== 'tool_use').map((block) => block?.text || '').filter(Boolean).join('\n') || null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    }];
  }

  const output = [];
  const ordinary = blocks.filter((block) => block?.type !== 'tool_result');
  if (ordinary.length) output.push({ role: 'user', content: openAIContent(ordinary) });
  for (const block of blocks.filter((item) => item?.type === 'tool_result' && item.tool_use_id)) {
    const content = typeof block.content === 'string'
      ? block.content
      : Array.isArray(block.content)
        ? block.content.map((item) => item?.text || '').filter(Boolean).join('\n')
        : JSON.stringify(block.content ?? '');
    output.push({ role: 'tool', tool_call_id: block.tool_use_id, content });
  }
  return output;
}

export function toPodChatRequest(body, model = 'nex-base') {
  const messages = [];
  const system = textFromSystem(body?.system);
  if (system) messages.push({ role: 'system', content: system });
  for (const message of body?.messages || []) messages.push(...convertMessage(message));

  const tools = (body?.tools || [])
    .filter((tool) => tool?.name)
    .map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.input_schema || { type: 'object', properties: {} },
      },
    }));

  let toolChoice;
  if (body?.tool_choice?.type === 'tool' && body.tool_choice.name) {
    toolChoice = { type: 'function', function: { name: body.tool_choice.name } };
  } else if (body?.tool_choice?.type === 'none') {
    toolChoice = 'none';
  } else if (tools.length) {
    toolChoice = 'auto';
  }

  return {
    model,
    messages,
    max_tokens: body?.max_tokens || 8192,
    stream: false,
    chat_template_kwargs: { reasoning_effort: 'medium' },
    ...(tools.length ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
  };
}

function parsedArguments(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '{}')); } catch { return {}; }
}

export function fromPodChatResponse(payload, fallbackModel = 'nex-base') {
  const choice = payload?.choices?.[0] || {};
  const message = choice.message || {};
  const content = [];
  if (typeof message.content === 'string' && message.content.trim()) {
    content.push({ type: 'text', text: message.content });
  }
  for (const call of message.tool_calls || []) {
    if (!call?.id || !call.function?.name) continue;
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.function.name,
      input: parsedArguments(call.function.arguments),
    });
  }
  return {
    id: payload?.id || `pod-${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: payload?.model || fallbackModel,
    content,
    stop_reason: message.tool_calls?.length
      ? 'tool_use'
      : choice.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
    usage: {
      input_tokens: payload?.usage?.prompt_tokens || 0,
      output_tokens: payload?.usage?.completion_tokens || 0,
    },
  };
}
