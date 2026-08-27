export function createReconnectRefreshQueue(
  refresh: () => Promise<void>,
  canRefresh: () => boolean,
) {
  let pending = false;
  let refreshing = false;

  const run = (): void => {
    pending = false;
    refreshing = true;
    void refresh().finally(() => {
      refreshing = false;
      if (pending && canRefresh()) run();
    });
  };

  return {
    markDisconnected(): void {
      pending = true;
    },
    refreshIfPending(): void {
      if (pending && !refreshing) run();
    },
  };
}

export async function retryCatalogAndTranscript(
  syncCatalog: () => Promise<void>,
  selectedSessionID: () => string | undefined,
  hydrateTranscript: (sessionID: string) => Promise<void>,
): Promise<void> {
  await syncCatalog();
  const sessionID = selectedSessionID();
  if (sessionID !== undefined) await hydrateTranscript(sessionID);
}
