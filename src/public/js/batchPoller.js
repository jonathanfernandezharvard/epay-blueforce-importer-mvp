export async function startPolling(batchId, onUpdate) {
  let done = false;
  while (!done) {
    try {
      const res = await fetch(`/api/batches/${batchId}`, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      onUpdate(data);
      if (data.status === 'Done' || data.status === 'Error') {
        done = true;
        break;
      }
    } catch (e) {
      console.error('Polling failed', e);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
