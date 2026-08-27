import type { OpenCodeEvent } from "@opencode-ai/client";

export type OpenCodeEventSource = {
  readonly emit: (event: OpenCodeEvent) => void;
  readonly on: <Type extends OpenCodeEvent["type"]>(
    type: Type,
    handler: (event: Extract<OpenCodeEvent, { type: Type }>) => void,
  ) => () => void;
  readonly listen: (
    handler: (event: { name: OpenCodeEvent["type"]; details: OpenCodeEvent }) => void,
  ) => () => void;
  readonly close: () => void;
};

const isEventType = <Type extends OpenCodeEvent["type"]>(
  event: OpenCodeEvent,
  type: Type,
): event is Extract<OpenCodeEvent, { type: Type }> => event.type === type;

/**
 * A small, typed bridge between the client's event stream and createData.
 * It deliberately owns no OpenCode state: createData remains the reducer and
 * this source only forwards the events currently in flight.
 */
export function createOpenCodeEventSource(): OpenCodeEventSource {
  const typed = new Map<OpenCodeEvent["type"], Set<(event: OpenCodeEvent) => void>>();
  const listeners = new Set<
    (event: { name: OpenCodeEvent["type"]; details: OpenCodeEvent }) => void
  >();
  let closed = false;

  function emit(event: OpenCodeEvent): void {
    if (closed) return;

    const notification = { name: event.type, details: event } as const;
    listeners.forEach((handler) => handler(notification));
    typed.get(event.type)?.forEach((handler) => handler(event));
  }

  function on<Type extends OpenCodeEvent["type"]>(
    type: Type,
    handler: (event: Extract<OpenCodeEvent, { type: Type }>) => void,
  ): () => void {
    if (closed) return () => undefined;

    const handlers = typed.get(type) ?? new Set<(event: OpenCodeEvent) => void>();
    const callback = (event: OpenCodeEvent): void => {
      if (isEventType(event, type)) handler(event);
    };
    handlers.add(callback);
    typed.set(type, handlers);
    return () => handlers.delete(callback);
  }

  function listen(
    handler: (event: { name: OpenCodeEvent["type"]; details: OpenCodeEvent }) => void,
  ): () => void {
    if (closed) return () => undefined;
    listeners.add(handler);
    return () => listeners.delete(handler);
  }

  return {
    emit,
    on,
    listen,
    close() {
      closed = true;
      typed.clear();
      listeners.clear();
    },
  };
}
