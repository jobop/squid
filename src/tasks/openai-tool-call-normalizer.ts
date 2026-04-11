export interface NormalizedOpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeSingleToolCall(raw: Record<string, unknown>): NormalizedOpenAIToolCall {
  const fn = (raw.function as Record<string, unknown> | undefined) || {};
  return {
    id: asString(raw.id),
    type: 'function',
    function: {
      name: asString(fn.name),
      arguments: asString(fn.arguments),
    },
  };
}

export function normalizeOpenAIMessageToolCalls(
  message: Record<string, unknown>
): NormalizedOpenAIToolCall[] {
  const direct = Array.isArray(message.tool_calls)
    ? message.tool_calls
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item) => normalizeSingleToolCall(item))
    : [];

  if (direct.length > 0) {
    return direct;
  }

  // OpenAI-compatible fallback: some providers still return legacy `function_call`.
  const functionCall = (message.function_call as Record<string, unknown> | undefined) || null;
  if (!functionCall) {
    return [];
  }
  const name = asString(functionCall.name).trim();
  if (!name) {
    return [];
  }
  return [
    {
      id: '',
      type: 'function',
      function: {
        name,
        arguments: asString(functionCall.arguments),
      },
    },
  ];
}

function pickStreamSlot(
  currentCalls: Array<NormalizedOpenAIToolCall | undefined>,
  delta: Record<string, unknown>
): number {
  const explicitIndex = delta.index;
  if (typeof explicitIndex === 'number' && explicitIndex >= 0) {
    return explicitIndex;
  }

  const id = asString(delta.id);
  if (id) {
    const idIndex = currentCalls.findIndex((item) => item?.id === id);
    if (idIndex >= 0) {
      return idIndex;
    }
  }

  // Fallback for providers that omit index in streaming chunks.
  if (currentCalls.length === 0) {
    return 0;
  }
  return currentCalls.length - 1;
}

export function mergeOpenAIStreamToolCallDelta(
  currentCalls: Array<NormalizedOpenAIToolCall | undefined>,
  deltaToolCall: Record<string, unknown>
): void {
  const slot = pickStreamSlot(currentCalls, deltaToolCall);
  const deltaFunction = (deltaToolCall.function as Record<string, unknown> | undefined) || {};
  if (!currentCalls[slot]) {
    currentCalls[slot] = {
      id: asString(deltaToolCall.id),
      type: 'function',
      function: {
        name: asString(deltaFunction.name),
        arguments: '',
      },
    };
  }

  const current = currentCalls[slot]!;
  const nextId = asString(deltaToolCall.id);
  if (nextId) {
    current.id = nextId;
  }
  const nextName = asString(deltaFunction.name);
  if (nextName) {
    current.function.name = nextName;
  }
  const argChunk = asString(deltaFunction.arguments);
  if (argChunk) {
    current.function.arguments += argChunk;
  }
}
