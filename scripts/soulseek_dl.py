#!/usr/bin/env python3
"""One-shot Soulseek downloader built on aioslsk. Exec'd per-download like yt-dlp.

Modes
-----
* default (auto): search -> auto-pick best candidate -> download -> print JSON
* --search-only  : search -> print a JSON array of candidates -> exit 0
* --dl-username <u> --dl-filename <f> : download that exact file directly (no re-search)
* --select <idx> : (DEPRECATED) re-run the same search -> download candidate[idx] -> print JSON
* --test         : start + login only -> print {"ok": true, ...} or {"error": ...}

Contract
--------
* On success the script prints exactly one JSON object to STDOUT and exits 0.
  - search-only : a JSON array of candidate objects
  - auto/select : the chosen candidate object (with an added "path" field)
* On failure it prints ``{"error": "<message>"}`` to STDOUT and exits non-zero
  (1 = no match, 2 = download failed, 3 = auth/network/timeout). All non-JSON
  diagnostics go to stderr; the Go caller parses stdout only.

aioslsk API notes (confirmed against aioslsk 1.6.3 source)
---------------------------------------------------------
* ``SearchResult.shared_items`` is ``list[FileData]``. ``FileData`` exposes
  ``.filename`` (str), ``.filesize`` (int bytes), ``.extension`` (str) and
  ``.attributes`` (``list[Attribute]`` where ``Attribute(key:int, value:int)``).
  Attribute keys are the ``AttributeKey`` enum (BITRATE=0, DURATION=1, ...).
  Use ``FileData.get_attribute_map()`` -> ``dict[AttributeKey, int]`` to read
  them. There is no ``.size`` field and no string-keyed attributes dict.
* ``client.transfers.download(user, filename)`` returns a ``Transfer`` and runs
  the transfer in the background. There is no ``wait_for_completion`` helper and
  no ``TransferCompletedEvent`` in 1.6.3. Completion is detected by polling
  ``transfer.is_finalized()`` (True for COMPLETE/ABORTED/FAILED) and then
  checking ``transfer.state.VALUE == TransferState.COMPLETE``. The downloaded
  file's absolute path is on ``transfer.local_path``.
"""

import argparse
import asyncio
import json
import os
import sys

try:
    from aioslsk.client import SoulSeekClient
    from aioslsk.settings import (
        Settings,
        CredentialsSettings,
        NetworkSettings,
        ListeningSettings,
        ListeningConnectionErrorMode,
        SharesSettings,
        SharedDirectorySettingEntry,
    )
    from aioslsk.shares.model import DirectoryShareMode
    from aioslsk.protocol.primitives import AttributeKey
    from aioslsk.transfer.state import TransferState
except ImportError:
    print(json.dumps({"error": "aioslsk not installed. Run: pip install aioslsk (or use Docker where it's pre-installed)"}))
    sys.exit(1)


# --- errors / output --------------------------------------------------------

def emit_error(message: str) -> None:
    """Print a single JSON error object to stdout (Go caller reads stdout)."""
    print(json.dumps({"error": message}), flush=True)


def emit(obj) -> None:
    """Print a single JSON object/array to stdout."""
    print(json.dumps(obj), flush=True)


def remove_local(transfer) -> None:
    """Delete the .incomplete file aioslsk leaves behind on a failed transfer.

    aioslsk writes in-progress downloads to ``settings.shares.download`` (pinned
    to --out). On failure/abort the partial file is never cleaned up, so we do
    it here to avoid polluting the real music library.
    """
    p = getattr(transfer, "local_path", None)
    if p:
        try:
            os.remove(p)
        except OSError:
            pass


# --- candidate helpers ------------------------------------------------------

# 1 MB: results smaller than this are almost always junk/previews.
MIN_USEFUL_SIZE = 1024 * 1024


def detect_format(filename: str, extension: str = "") -> str:
    """Return the lowercase extension (no dot), preferring the filename suffix."""
    ext = os.path.splitext(filename)[1].lstrip(".").lower()
    if not ext and extension:
        ext = extension.strip().lower()
    return ext or "unknown"


def _attr_value(attribute_map: dict, key) -> int:
    """Read an integer attribute from a FileData attribute map, tolerating
    either an AttributeKey enum or its raw int value as the key."""
    if key in attribute_map:
        return int(attribute_map[key] or 0)
    # some builds may expose raw int keys
    raw = getattr(key, "value", key)
    if raw in attribute_map:
        return int(attribute_map[raw] or 0)
    return 0


def flatten_results(results) -> list:
    """Flatten aioslsk ``SearchResult``s into our candidate dicts.

    Attribute names confirmed against aioslsk 1.6.3: ``FileData.filesize`` for
    size and ``FileData.get_attribute_map()`` keyed by ``AttributeKey`` for
    bitrate/duration.
    """
    out = []
    for r in results:
        username = getattr(r, "username", "") or ""
        for item in getattr(r, "shared_items", []) or []:
            filename = getattr(item, "filename", "") or ""
            size = int(getattr(item, "filesize", 0) or 0)
            try:
                amap = item.get_attribute_map() or {}
            except Exception:
                amap = {}
            bitrate = _attr_value(amap, AttributeKey.BITRATE)
            duration = _attr_value(amap, AttributeKey.DURATION)
            out.append({
                "username": username,
                "filename": filename,
                "size": size,
                "bitrate": bitrate or None,
                "duration": duration or None,
                "format": detect_format(filename, getattr(item, "extension", "") or ""),
            })
    return out


def rank_candidates(items: list) -> list:
    """Deterministic ordering so that ``--select <idx>`` maps to the same file
    on a re-search. Sort by (format_priority, -bitrate, filename, username)."""
    def priority(fmt: str) -> int:
        return {"flac": 0, "mp3": 1}.get(fmt, 2)

    return sorted(
        items,
        key=lambda c: (
            priority(c.get("format") or ""),
            -(c.get("bitrate") or 0),
            c.get("filename") or "",
            c.get("username") or "",
        ),
    )


def index_candidates(items: list) -> list:
    """Assign stable 0-based indices after ranking."""
    for i, c in enumerate(items):
        c["index"] = i
    return items


def pick_candidate(items: list, fmt: str, min_bitrate: int):
    """Auto-pick heuristic ("good not best"):

    * drop candidates with size < 1MB (junk)
    * prefer the first FLAC
    * else the first MP3 with bitrate >= min_bitrate
    * else the first remaining candidate
    Returns the chosen candidate dict or None.

    When ``fmt`` is not ``any`` the pool is first restricted to that format.
    """
    pool = [c for c in items if c.get("size", 0) >= MIN_USEFUL_SIZE]
    if fmt != "any":
        pool = [c for c in pool if (c.get("format") or "") == fmt]
    if not pool:
        return None

    flacs = [c for c in pool if c.get("format") == "flac"]
    if flacs:
        return flacs[0]

    mp3s = [
        c for c in pool
        if c.get("format") == "mp3" and (c.get("bitrate") or 0) >= min_bitrate
    ]
    if mp3s:
        return mp3s[0]

    return pool[0]


# --- aioslsk workflow -------------------------------------------------------

def clean_corrupt_shares(share_dir: str):
    """Remove corrupt audio files from the share folder that would crash
    aioslsk's mutagen-based share scanner during login."""
    import glob
    for fpath in glob.glob(os.path.join(share_dir, "**", "*"), recursive=True):
        if not os.path.isfile(fpath):
            continue
        ext = os.path.splitext(fpath)[1].lower()
        if ext not in (".flac", ".mp3", ".ogg", ".m4a", ".opus"):
            continue
        try:
            # Quick size check — files under 100KB are almost certainly junk
            if os.path.getsize(fpath) < 10240:
                os.remove(fpath)
                print(f"[share-cleanup] removed tiny file: {fpath}", file=sys.stderr, flush=True)
                continue
            # mutagen validation (same library aioslsk uses)
            from mutagen import File as MutagenFile
            m = MutagenFile(fpath)
            if m is None:
                os.remove(fpath)
                print(f"[share-cleanup] removed unreadable file: {fpath}", file=sys.stderr, flush=True)
        except Exception as e:
            os.remove(fpath)
            print(f"[share-cleanup] removed corrupt file {fpath}: {e}", file=sys.stderr, flush=True)


def build_client(args) -> SoulSeekClient:
    # aioslsk writes downloaded files to settings.shares.download (defaults to
    # CWD!). Pin it to --out so partial/completed files never land in the
    # caller's working directory. Test mode has no --out; the share dir is a
    # harmless placeholder there (no download is performed).
    download_dir = getattr(args, "out", None) or args.share
    settings = Settings(
        credentials=CredentialsSettings(username=args.username, password=args.password),
        network=NetworkSettings(
            listening=ListeningSettings(
                port=0,
                obfuscated_port=0,
                error_mode=ListeningConnectionErrorMode.ANY,
            ),
        ),
        shares=SharesSettings(
            scan_on_start=True,
            download=download_dir,
            directories=[
                SharedDirectorySettingEntry(path=args.share, share_mode=DirectoryShareMode.EVERYONE)
            ],
        ),
    )
    return SoulSeekClient(settings)


async def gather_search(client: SoulSeekClient, query: str, window: float = 30.0) -> list:
    """Run a search and accumulate results for a bounded window.

    Soulseek results trickle in over several seconds, so we collect everything
    that arrives within ``window`` rather than blocking on a completion signal.
    We stop early once the result count has been stable for three consecutive
    polls (so quick/definitive searches don't wait the full window).
    """
    req = await client.searches.search(query)
    loop = asyncio.get_event_loop()
    deadline = loop.time() + window
    prev_count = -1
    stable = 0
    while True:
        await asyncio.sleep(1.0)
        count = len(getattr(req, "results", []) or [])
        if count == prev_count:
            stable += 1
        else:
            stable = 0
        prev_count = count
        # Early exit: results have stopped arriving for ~3s.
        if count > 0 and stable >= 3:
            break
        if loop.time() >= deadline:
            break
    return getattr(req, "results", []) or []


async def await_completion(transfer, expected_size: int = 0, poll: float = 0.5) -> bool:
    """Poll until the transfer reaches a finalized state.

    Emits progress lines to stderr as ``PROGRESS:pct:done_bytes:total_bytes``
    so the Go side can parse and surface them in the UI.
    """
    total = getattr(transfer, 'filesize', 0) or expected_size
    local_path = getattr(transfer, 'local_path', None)
    last_pct = -1
    while not transfer.is_finalized():
        if total > 0 and local_path:
            try:
                done = os.path.getsize(local_path)
                pct = min(100, int(done * 100 / total))
                if pct != last_pct:
                    print(f"PROGRESS:{pct}:{done}:{total}", file=sys.stderr, flush=True)
                    last_pct = pct
            except OSError:
                pass
        await asyncio.sleep(poll)
    return transfer.state.VALUE == TransferState.COMPLETE


async def do_download(client: SoulSeekClient, chosen: dict, args) -> int:
    """Download ``chosen`` into ``args.out`` and print the result JSON.

    Returns 0 on success (result JSON printed), 2 on failure (error stored in
    chosen['_error'] for multi-candidate mode, or emitted for single-candidate).
    """
    username = chosen.get("username", "")
    filename = chosen.get("filename", "")
    try:
        transfer = await client.transfers.download(username, filename)
    except Exception as e:
        chosen["_error"] = f"download request failed: {e}"
        return 2

    try:
        ok = await await_completion(transfer, chosen.get("size", 0))
    except Exception as e:
        remove_local(transfer)
        chosen["_error"] = f"download failed: {e}"
        return 2

    if not ok:
        remove_local(transfer)
        reason = getattr(transfer, "fail_reason", None) or getattr(transfer, "abort_reason", None) or "transfer did not complete"
        chosen["_error"] = f"download failed: {reason}"
        return 2

    local_path = getattr(transfer, "local_path", None)
    # Soulseek peers use Windows-style backslash paths (e.g. "Music\Artist\...").
    # On Unix, os.path.basename doesn't split on '\', so normalize first.
    basename = filename.replace("\\", "/").split("/")[-1] or "download"
    dest = os.path.join(args.out, basename)

    if not local_path or not os.path.exists(local_path):
        emit_error("completed file not found")
        return 2

    if os.path.abspath(local_path) != os.path.abspath(dest):
        try:
            os.makedirs(args.out, exist_ok=True)
            os.replace(local_path, dest)
        except OSError:
            # os.replace can fail across filesystems; fall back to copy+remove.
            import shutil
            try:
                shutil.move(local_path, dest)
            except Exception as e:
                emit_error(f"could not move downloaded file: {e}")
                return 2

    result = dict(chosen)
    result["path"] = dest
    emit(result)
    return 0


async def run_test(args) -> int:
    """Login-only mode used by the one-click onboarding.

    Builds the client with the share (so the scan path is exercised, matching
    real usage), starts it and logs in. Prints ``{"ok": true, "username": ...}``
    on success (exit 0) or ``{"error": ...}`` (exit 3). ``client.stop()`` always
    runs in the finally. No search/download is performed.
    """
    os.makedirs(args.share, exist_ok=True)
    client = build_client(args)
    try:
        try:
            await client.start()
            await client.login()
        except Exception as e:
            emit_error(str(e))
            return 3
        emit({"ok": True, "username": args.username})
        return 0
    finally:
        try:
            await client.stop()
        except Exception:
            pass


async def run(args) -> int:
    os.makedirs(args.share, exist_ok=True)
    if not args.search_only:
        os.makedirs(args.out, exist_ok=True)

    client = build_client(args)
    try:
        try:
            await client.start()
            await client.login()
        except Exception as e:
            emit_error(f"auth/network: {e}")
            return 3

        # Direct download mode (C6): download the exact user+filename the Go
        # caller already chose, WITHOUT re-running the non-deterministic search.
        # The search that produced the picker results may return a different
        # ordering on a second invocation, so an index would map to another file.
        if args.dl_username and args.dl_filename:
            chosen = {
                "username": args.dl_username,
                "filename": args.dl_filename,
            }
            rc = await do_download(client, chosen, args)
            if rc != 0:
                emit_error(chosen.get("_error", "download failed"))
            return rc

        # Multi-candidate download mode: try each candidate in order until one
        # succeeds. Peers are frequently unreachable (firewall/NAT), so trying
        # multiple candidates dramatically improves success rate.
        if args.dl_candidates:
            import json as _json
            try:
                candidates = _json.loads(args.dl_candidates)
            except Exception:
                emit_error("invalid --dl-candidates JSON")
                return 3
            errors = []
            for cand in candidates:
                u = cand.get("username", "")
                f = cand.get("filename", "")
                if not u or not f:
                    continue
                print(f"[dl] trying {u}...", file=sys.stderr, flush=True)
                rc = await do_download(client, cand, args)
                if rc == 0:
                    return 0
                errors.append(f"{u}: {cand.get('_error', 'failed')}")
            emit_error("all candidates failed: " + "; ".join(errors))
            return 3

        try:
            results = await gather_search(client, args.query)
        except Exception as e:
            emit_error(f"search failed: {e}")
            return 3

        flat = index_candidates(rank_candidates(flatten_results(results)))

        if args.search_only:
            emit(flat)
            return 0 if flat else 1

        if args.select is not None:
            if 0 <= args.select < len(flat):
                chosen = flat[args.select]
            else:
                chosen = None
        else:
            chosen = pick_candidate(flat, args.format, args.min_bitrate)

        if not chosen:
            emit_error("no matching Soulseek result")
            return 1

        rc = await do_download(client, chosen, args)
        if rc != 0:
            emit_error(chosen.get("_error", "download failed"))
        return rc
    finally:
        try:
            await client.stop()
        except Exception:
            pass


def build_argparser(test_mode: bool = False) -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="One-shot Soulseek downloader (aioslsk). Exec'd per-download."
    )
    p.add_argument("--username", required=True, help="Soulseek username")
    p.add_argument("--password", default=None, help="Soulseek password (or set SLSK_PASSWORD env var; env var preferred so it doesn't show in ps)")
    p.add_argument("--share", required=True, help="Directory to share (must exist/be shareable)")
    required = not test_mode
    p.add_argument("--query", required=required, help='Search query, e.g. "Artist - Title"')
    p.add_argument("--out", required=required, help="Output directory for downloaded files")
    p.add_argument("--search-only", action="store_true", help="Only search; print candidate array and exit")
    p.add_argument("--select", type=int, default=None, help="(Deprecated) 0-based index of candidate to download (re-searches)")
    p.add_argument("--dl-username", default=None, help="Direct download: sharer's username (downloads that exact file, no re-search)")
    p.add_argument("--dl-filename", default=None, help="Direct download: remote filename path to download")
    p.add_argument("--dl-candidates", default=None, help="Multi-candidate download: JSON array of {username, filename, size} objects to try in order")
    p.add_argument("--min-bitrate", type=int, default=192, help="Minimum bitrate for auto-pick MP3s (default 192)")
    p.add_argument("--format", choices=["flac", "mp3", "any"], default="any", help="Preferred format filter for auto-pick (default any)")
    p.add_argument("--timeout", type=int, default=None, help="Overall timeout in seconds (overrides defaults)")
    p.add_argument("--test", action="store_true", help="Login-only smoke test (no search/download)")
    return p


def main() -> None:
    args = build_argparser("--test" in sys.argv).parse_args()

    # H8: password is read from the SLSK_PASSWORD env var (preferred) and falls
    # back to --password. The env var is preferred because argv is visible in ps.
    if not args.password:
        args.password = os.environ.get("SLSK_PASSWORD")
    if not args.password:
        emit_error("no Soulseek password provided (set SLSK_PASSWORD env var or pass --password)")
        sys.exit(3)

    # Default timeouts: test is quick, search-only is quick, downloads can be slow.
    if args.timeout is not None:
        timeout = float(args.timeout)
    elif args.test:
        timeout = 60.0
    elif args.search_only:
        timeout = 120.0
    else:
        timeout = 600.0

    coro = run_test(args) if args.test else run(args)

    # Clean corrupt share files before connecting — a single bad FLAC crashes
    # aioslsk's mutagen scanner and prevents login entirely.
    try:
        clean_corrupt_shares(args.share)
    except Exception as e:
        print(f"[share-cleanup] warning: {e}", file=sys.stderr, flush=True)

    try:
        rc = asyncio.run(asyncio.wait_for(coro, timeout=timeout))
    except asyncio.TimeoutError:
        emit_error("timeout")
        sys.exit(3)
    except KeyboardInterrupt:
        emit_error("interrupted")
        sys.exit(3)
    except BaseException as e:
        # Any uncaught exception (incl. CancelledError from wait_for cancellation,
        # or an aioslsk internal error that escapes the per-mode try/except) would
        # otherwise leave stdout empty and only print a traceback to stderr — the
        # Go caller reads stdout and would see no JSON. Emit a JSON error so the
        # real exception type+message always reaches the caller.
        emit_error(f"{type(e).__name__}: {e}")
        sys.exit(3)
    sys.exit(rc)


if __name__ == "__main__":
    main()
