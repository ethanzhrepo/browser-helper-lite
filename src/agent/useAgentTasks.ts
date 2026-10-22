import { useCallback, useEffect, useRef, useState } from 'react';
import { browser, type Browser } from 'wxt/browser';
import { getTasks } from '../storage/db';
import { ACTIVE_STATUSES, AGENT_PORT_NAME, type AgentClientMessage, type AgentServerMessage, type AgentTask } from './types';

const KEEPALIVE_MS = 20_000;

/**
 * Live agent tasks for the side panel: stored tasks of the conversation plus
 * updates pushed by the background agent service.
 */
export function useAgentTasks(conversationId: string | undefined, onFinished: (task: AgentTask) => void) {
  const [tasks, setTasks] = useState<Record<string, AgentTask>>({});
  const portRef = useRef<Browser.runtime.Port | undefined>(undefined);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const port = browser.runtime.connect({ name: AGENT_PORT_NAME });
      portRef.current = port;
      port.onMessage.addListener((message: AgentServerMessage) => {
        if (message.type !== 'task') return;
        const task = message.task;
        setTasks((previous) => ({ ...previous, [task.id]: task }));
        // The service sends a final update after it has stored the summary
        // message, so reload on every update of a finished task.
        if (!ACTIVE_STATUSES.includes(task.status)) onFinishedRef.current(task);
      });
      // The service worker restarted: reconnect so updates keep flowing.
      port.onDisconnect.addListener(() => {
        if (!disposed) retry = setTimeout(connect, 1000);
      });
      port.postMessage({ type: 'subscribe' } satisfies AgentClientMessage);
    };
    connect();
    // Keeps the service worker awake while the panel waits on a task.
    const keepalive = setInterval(() => portRef.current?.postMessage({ type: 'ping' }), KEEPALIVE_MS);

    return () => {
      disposed = true;
      clearTimeout(retry);
      clearInterval(keepalive);
      portRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    void getTasks(conversationId).then((stored) =>
      setTasks((previous) => {
        const next = { ...previous };
        // Live updates win over what is stored.
        for (const task of stored) if (!next[task.id] || next[task.id]!.updatedAt < task.updatedAt) next[task.id] = task;
        return next;
      }),
    );
  }, [conversationId]);

  const send = useCallback((message: AgentClientMessage) => portRef.current?.postMessage(message), []);

  return { tasks, send };
}
