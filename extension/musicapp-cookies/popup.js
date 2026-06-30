"use strict";

const STORAGE_KEY = "serverUrl";

document.addEventListener("DOMContentLoaded", () => {
  const urlInput = document.getElementById("server-url");
  const sendBtn = document.getElementById("send-btn");
  const status = document.getElementById("status");

  // Restore the last-used server address.
  chrome.storage.local.get(STORAGE_KEY, (data) => {
    if (data && typeof data[STORAGE_KEY] === "string") {
      urlInput.value = data[STORAGE_KEY];
    }
  });

  // Persist the server address whenever it changes.
  urlInput.addEventListener("input", () => {
    chrome.storage.local.set({ [STORAGE_KEY]: urlInput.value.trim() });
  });

  sendBtn.addEventListener("click", () => {
    sendCookies(urlInput, status);
  });
});

function setStatus(statusEl, message, kind) {
  statusEl.textContent = message;
  statusEl.classList.remove("ok", "error");
  if (kind) {
    statusEl.classList.add(kind);
  }
}

async function sendCookies(urlInput, statusEl) {
  try {
    // a. Read + validate the server URL.
    const raw = (urlInput.value || "").trim();
    let parsed;
    try {
      parsed = new URL(raw);
    } catch (_) {
      setStatus(statusEl, "Enter a valid http:// or https:// server address.", "error");
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setStatus(statusEl, "Server address must start with http:// or https://.", "error");
      return;
    }

    // b. Strip path/query: keep origin only.
    const origin = parsed.protocol + "//" + parsed.host;

    // c. Ask for permission to reach this server (optional host permission).
    const granted = await chrome.permissions.request({ origins: [origin + "/*"] });
    if (!granted) {
      setStatus(statusEl, "Need permission to reach your server.", "error");
      return;
    }

    // d. Gather + dedupe cookies.
    const yt = await chrome.cookies.getAll({ domain: "youtube.com" });
    const gg = await chrome.cookies.getAll({ domain: "google.com" });
    const cookies = dedupe([...yt, ...gg]);
    const count = cookies.length;

    // e + f. Convert to Netscape cookies.txt text.
    const text = toNetscapeText(cookies);

    // g. Upload to the user's server.
    const blob = new Blob([text], { type: "text/plain" });
    const form = new FormData();
    form.append("file", blob, "cookies.txt");

    const res = await fetch(origin + "/api/cookies/upload", {
      method: "POST",
      body: form,
    });

    let json = null;
    try {
      json = await res.json();
    } catch (_) {
      json = null;
    }

    if (res.ok && json && json.ok) {
      setStatus(statusEl, "Sent " + count + " cookies", "ok");
    } else {
      const msg = json && json.error ? json.error : "Upload failed.";
      setStatus(statusEl, msg, "error");
    }
  } catch (err) {
    // h. Surface any unexpected error.
    setStatus(statusEl, (err && err.message) ? err.message : "Something went wrong.", "error");
  }
}

function dedupe(cookies) {
  const seen = new Set();
  const out = [];
  for (const c of cookies) {
    const key = c.domain + "|" + c.name + "|" + c.path;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(c);
  }
  return out;
}

function toNetscapeText(cookies) {
  const header = "# Netscape HTTP Cookie File\n# Exported by MusicApp Cookie Sync\n";
  const lines = cookies.map(toNetscapeLine);
  return header + lines.join("\n") + "\n";
}

function toNetscapeLine(c) {
  // field0: domain (with leading dot for non-host-only; #HttpOnly_ prefix when httpOnly)
  let domain = c.domain || "";
  if (c.hostOnly === false && !domain.startsWith(".")) {
    domain = "." + domain;
  }
  if (c.httpOnly === true) {
    domain = "#HttpOnly_" + domain;
  }

  // field1: includeSubdomains
  const includeSubdomains = c.hostOnly ? "FALSE" : "TRUE";
  // field2: path
  const path = c.path || "/";
  // field3: secure
  const secure = c.secure ? "TRUE" : "FALSE";
  // field4: expiration (session cookies -> 0)
  const expiration = c.expirationDate ? String(Math.floor(c.expirationDate)) : "0";
  // field5 + field6: name, value
  const name = c.name || "";
  const value = c.value || "";

  return [domain, includeSubdomains, path, secure, expiration, name, value].join("\t");
}
