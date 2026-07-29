export function logEvent(event: string, fields: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({ timestamp: new Date().toISOString(), level: "info", event, ...fields }),
  );
}

export function logError(event: string, fields: Record<string, unknown> = {}) {
  console.error(
    JSON.stringify({ timestamp: new Date().toISOString(), level: "error", event, ...fields }),
  );
}
