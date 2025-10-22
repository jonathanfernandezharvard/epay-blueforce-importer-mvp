const FORM_ID = "submit-form";
const FEEDBACK_ID = "submit-feedback";
const ACTIVE_STATUSES = new Set(["Queued", "Running"]);

function setMessage(container, type, text, extra = "") {
  if (!container) return;
  container.innerHTML = `
    <div class="notice notice--${type}">
      <p>${text}</p>
      ${extra}
    </div>
  `;
}

async function pollBatch(batchId, container, signal) {
  let attempt = 0;
  const maxAttempts = 30; // 5 minutes @ 10s

  while (!signal.aborted && attempt < maxAttempts) {
    attempt += 1;
    try {
      const response = await fetch(`/api/batches/${batchId}`, {
        headers: { Accept: "application/json" },
        signal,
      });
      if (!response.ok) throw new Error(`Status ${response.status}`);
      const batch = await response.json();

      if (!ACTIVE_STATUSES.has(batch.status)) {
        if (batch.status === "Done") {
          const affected = Array.isArray(batch.items)
            ? batch.items.filter((item) => item.status === "Imported").length
            : 0;
          const summary =
            affected > 0
              ? `<p>Imported ${affected} job${affected === 1 ? "" : "s"} successfully.</p>`
              : "";
          setMessage(
            container,
            "success",
            "Import complete!",
            `<p>Outcome: ${batch.outcome || "Succeeded."}</p>
             ${summary}
             <p><a href="/batches/${batch.id}" target="_blank" rel="noreferrer">View batch details</a></p>`
          );
        } else {
          const failingItems = Array.isArray(batch.items)
            ? batch.items.filter((item) => item.status !== "Imported" && item.message)
            : [];
          const list =
            failingItems.length > 0
              ? `<ul>${failingItems
                  .map(
                    (item) =>
                      `<li><strong>${item.siteCode || "Unknown site"}</strong>: ${
                        item.message || item.status || "Failed"
                      }</li>`
                  )
                  .join("")}</ul>`
              : "";
          const reason = batch.outcome || (list ? "Some rows failed." : "See batch details for more information.");
          setMessage(
            container,
            "error",
            "Import finished with errors.",
            `<p>Reason: ${reason}</p>
             ${list}
             <p><a href="/batches/${batch.id}" target="_blank" rel="noreferrer">Review batch</a></p>`
          );
        }
        return;
      }
    } catch (err) {
      if (signal.aborted) return;
      setMessage(container, "error", `Unable to fetch batch status. ${err}`);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  if (!signal.aborted) {
    setMessage(
      container,
      "warning",
      "Still processing... you'll see updates on the Batch Activity page.",
      `<p><a href="/batches/${batchId}" target="_blank" rel="noreferrer">Open batch ${batchId}</a></p>`
    );
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById(FORM_ID);
  const feedback = document.getElementById(FEEDBACK_ID);
  if (!form || !feedback) return;

  let controller = null;
  const submitButton = form.querySelector('button[type="submit"]');
  let csrfValue = form.querySelector('input[name="_csrf"]')?.value ?? "";

  form.addEventListener("submit", async (event) => {
    if (controller) {
      controller.abort();
      controller = null;
    }
    if (event.defaultPrevented) return;
    event.preventDefault();

    const formData = new FormData(form);
    const payload = new URLSearchParams();
    formData.forEach((value, key) => {
      if (typeof value === "string") {
        payload.append(key, value);
      }
    });
    controller = new AbortController();
    setMessage(feedback, "info", "Submitting import request...");
    if (submitButton) submitButton.disabled = true;
    try {
      const csrfToken = formData.get("_csrf") ?? csrfValue;
      const response = await fetch(form.action, {
        method: "POST",
        body: payload,
        headers: Object.assign(
          {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          },
          csrfToken ? { "X-CSRF-Token": csrfToken } : {}
        ),
        credentials: "same-origin",
        signal: controller.signal,
      });
      const raw = await response.text();
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }
      const headerCsrf = response.headers.get("X-CSRF-Token");
      if (headerCsrf) {
        csrfValue = headerCsrf;
      } else if (data?.csrfToken) {
        csrfValue = data.csrfToken;
      }
      if (!response.ok) {
        const details =
          data?.details && typeof data.details === "object"
            ? `<pre>${JSON.stringify(data.details, null, 2)}</pre>`
            : "";
        const message = data?.error || data?.message || raw || `Status ${response.status}`;
        throw new Error(`${message}${details}`);
      }
      data = data ?? {};
      const note = data.idempotent
        ? `<p>Matched a recent request; reusing batch <strong>${data.batchId}</strong>.</p>`
        : `<p>Batch ID: <strong>${data.batchId}</strong></p>`;
      setMessage(
        feedback,
        "info",
        "Batch queued. Redirecting to batch activity…",
        note
      );
      const csrfInput = form.querySelector('input[name="_csrf"]');
      form.reset();
      if (csrfInput && typeof csrfValue === "string") {
        csrfInput.value = csrfValue;
      }
      setTimeout(() => {
        window.location.assign(`/batches/${data.batchId}`);
      }, 400);
      return;
    } catch (err) {
      if (controller?.signal.aborted) return;
      const messageText = err instanceof Error ? err.message : String(err);
      if (/invalid csrf token/i.test(messageText)) {
        setMessage(
          feedback,
          "error",
          "Session expired. Refreshing the page to obtain a new security token..."
        );
        setTimeout(() => window.location.reload(), 1500);
        return;
      }
      setMessage(
        feedback,
        "error",
        "We could not submit your request.",
        `<p>${messageText}</p>`
      );
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
});
