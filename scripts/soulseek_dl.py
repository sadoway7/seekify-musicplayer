#!/usr/bin/env python3
"""One-shot Soulseek downloader built on aioslsk. Exec'd per-download like yt-dlp.

Modes
-----
* default (auto): search -> auto-pick best candidate -> download -> print JSON
* --search-only  : search -> print a JSON array of candidates -> exit 0
* --select <idx> : re-run the same search -> download candidate[idx] -> print JSON

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

from aioslsk.client import SoulSeekClient
from aioslsk.settings import (
    Settings,
    CredentialsSettings,
    SharesSettings,
    SharedDirectorySettingEntry,
)
from aioslsk.shares.model import DirectoryShareMode
from aioslsk.protocol.primitives import AttributeKey
from aioslsk.transfer.state import TransferState


# --- errors / output --------------------------------------------------------

def emit_error(message: str) -> None:
    """Print a single JSON error object to stdout (Go caller reads stdout)."""
    print(json.dumps({"error": message}))


def emit(obj) -> None:
    """Print a single JSON object/array to stdout."""
    print(json.dumps(obj))


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

def build_client(args) -> SoulSeekClient:
    settings = Settings(
        credentials=CredentialsSettings(username=args.username, password=args.password),
        shares=SharesSettings(
            scan_on_start=True,
            directories=[
                SharedDirectorySettingEntry(args.share, share_mode=DirectoryShareMode.EVERYONE)
            ],
        ),
    )
    return SoulSeekClient(settings)


async def gather_search(client: SoulSeekClient, query: str, window: float = 15.0) -> list:
    """Run a search and accumulate results for a bounded window.

    Soulseek results trickle in over several seconds, so we collect everything
    that arrives within ``window`` rather than blocking on a completion signal.
    We stop early once the result count has been stable for two consecutive
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
        # Early exit: results have stopped arriving for ~2s.
        if count > 0 and stable >= 2:
            break
        if loop.time() >= deadline:
            break
    return getattr(req, "results", []) or []


async def await_completion(transfer, poll: float = 0.5) -> bool:
    """Poll until the transfer reaches a finalized state.

    aioslsk 1.6.3 has no wait helper / completion event, so we poll
    ``transfer.is_finalized()`` (COMPLETE/ABORTED/FAILED). Returns True on
    COMPLETE, False otherwise.
    """
    while not transfer.is_finalized():
        await asyncio.sleep(poll)
    return transfer.state.VALUE == TransferState.COMPLETE


async def do_download(client: SoulSeekClient, chosen: dict, args) -> int:
    """Download ``chosen`` into ``args.out`` and print the result JSON."""
    username = chosen.get("username", "")
    filename = chosen.get("filename", "")
    try:
        transfer = await client.transfers.download(username, filename)
    except Exception as e:
        emit_error(f"download request failed: {e}")
        return 2

    try:
        ok = await await_completion(transfer)
    except Exception as e:
        emit_error(f"download failed: {e}")
        return 2

    if not ok:
        reason = getattr(transfer, "fail_reason", None) or getattr(transfer, "abort_reason", None) or "transfer did not complete"
        emit_error(f"download failed: {reason}")
        return 2

    local_path = getattr(transfer, "local_path", None)
    basename = os.path.basename(filename)
    dest = os.path.join(args.out, basename)

    if local_path and os.path.abspath(local_path) != os.path.abspath(dest):
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
    elif not local_path or not os.path.exists(dest):
        emit_error("completed file not found")
        return 2

    result = dict(chosen)
    result["path"] = dest
    emit(result)
    return 0


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

        return await do_download(client, chosen, args)
    finally:
        try:
            await client.stop()
        except Exception:
            pass


def build_argparser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="One-shot Soulseek downloader (aioslsk). Exec'd per-download."
    )
    p.add_argument("--username", required=True, help="Soulseek username")
    p.add_argument("--password", required=True, help="Soulseek password")
    p.add_argument("--share", required=True, help="Directory to share (must exist/be shareable)")
    p.add_argument("--query", required=True, help='Search query, e.g. "Artist - Title"')
    p.add_argument("--out", required=True, help="Output directory for downloaded files")
    p.add_argument("--search-only", action="store_true", help="Only search; print candidate array and exit")
    p.add_argument("--select", type=int, default=None, help="0-based index of candidate to download (re-searches)")
    p.add_argument("--min-bitrate", type=int, default=192, help="Minimum bitrate for auto-pick MP3s (default 192)")
    p.add_argument("--format", choices=["flac", "mp3", "any"], default="any", help="Preferred format filter for auto-pick (default any)")
    p.add_argument("--timeout", type=int, default=None, help="Overall timeout in seconds (overrides defaults)")
    return p


def main() -> None:
    args = build_argparser().parse_args()

    # Default timeouts: search-only is quick, downloads can be slow.
    if args.timeout is not None:
        timeout = float(args.timeout)
    elif args.search_only:
        timeout = 120.0
    else:
        timeout = 600.0

    try:
        rc = asyncio.run(asyncio.wait_for(run(args), timeout=timeout))
    except asyncio.TimeoutError:
        emit_error("timeout")
        sys.exit(3)
    except KeyboardInterrupt:
        emit_error("interrupted")
        sys.exit(3)
    sys.exit(rc)


if __name__ == "__main__":
    main()
