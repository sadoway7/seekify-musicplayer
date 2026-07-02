#!/usr/bin/env python3
"""
Ripper V2 enrichment pipeline.

Modes:
  search  — Parse title + search MusicBrainz for candidates (genres, cover art URLs)
  enrich  — Post-download: write full tags via mutagen, embed cover art, embed lyrics

Based on youtune (github.com/jschof1/youtune) approach:
  - musicbrainzngs for MusicBrainz lookup with genres
  - Cover Art Archive for cover art
  - lrclib for lyrics
  - mutagen for ID3/Vorbis tag writing
"""

import json
import re
import sys
from pathlib import Path
from typing import Optional

try:
    import musicbrainzngs
except ImportError:
    musicbrainzngs = None

try:
    import requests
except ImportError:
    requests = None

try:
    from mutagen.id3 import (
        APIC, ID3, ID3NoHeaderError,
        TALB, TCON, TDRC, TIT2, TPE1, TPE2, TRCK, USLT,
    )
    from mutagen.mp3 import MP3
    from mutagen.flac import FLAC, Picture
    from mutagen import File as MutagenFile
except ImportError:
    MP3 = None


# ─── Title Parsing ────────────────────────────────────────────────

JUNK_PATTERNS = [
    re.compile(r"\(?\b(official\s+)?(music\s+)?video\b\)?", re.IGNORECASE),
    re.compile(r"\(?\b(official\s+)?(audio|lyric(s)?|visuali[sz]er)\b\)?", re.IGNORECASE),
    re.compile(r"\(?\b(hd|4k|hq|remaster(ed)?|restored)\b\)?", re.IGNORECASE),
    re.compile(r"\(?\bfull\s+song\b\)?", re.IGNORECASE),
    re.compile(r"\(?\bfeat\.?\s+[^)]+\)?", re.IGNORECASE),
    re.compile(r"\[\s*[^]]*?\s*\]", re.IGNORECASE),
    re.compile(r"【\s*[^】]*?\s*】"),
]

TITLE_PATTERNS = [
    re.compile(
        r"^(?P<artist>.+?)\s*[-\u2013\u2014]\s*(?P<title>.+?)(?:\s*[\(\[](?:official|music|lyric|audio|video|visualiser|visualizer|hd|4k|remaster).+)?$",
        re.IGNORECASE,
    ),
    re.compile(r"^(?P<artist>.+?)\s*[\u00AB\u300E\u3010]\s*(?P<title>.+?)[\u00BB\u300F\u3011]"),
    re.compile(r'^["\'](?P<title>.+?)["\']\s+by\s+(?P<artist>.+?)$', re.IGNORECASE),
    re.compile(r"^(?P<artist>.+?)\s*[|]\s*(?P<title>.+?)$"),
]


def clean_title(text):
    for pat in JUNK_PATTERNS:
        text = pat.sub("", text)
    return re.sub(r"\s{2,}", " ", text).strip()


def parse_title(raw):
    raw = raw.strip()
    for pat in TITLE_PATTERNS:
        m = pat.match(raw)
        if m:
            artist = clean_title(m.group("artist")).strip()
            title = clean_title(m.group("title")).strip()
            if artist and title:
                return {"artist": artist, "title": title, "confidence": 0.9}
    for sep in [" - ", " \u2013 ", " \u2014 "]:
        if sep in raw:
            parts = raw.split(sep, 1)
            artist = clean_title(parts[0]).strip()
            title = clean_title(parts[1]).strip()
            if artist and title:
                return {"artist": artist, "title": title, "confidence": 0.7}
    cleaned = clean_title(raw)
    return {"artist": "", "title": cleaned, "confidence": 0.3}


# ─── MusicBrainz ──────────────────────────────────────────────────

_mb_initialized = False


def init_mb():
    global _mb_initialized
    if not _mb_initialized and musicbrainzngs:
        musicbrainzngs.set_useragent("musicapp-ripper-v2", "1.0", "https://github.com/musicapp")
        _mb_initialized = True


def _is_bad_release(title):
    t = title.lower()
    return any(w in t for w in [
        "live", "concert", "festival", "session", "cover", "tribute",
        "karaoke", "remix", "soundtrack", "score", "bootleg",
    ]) or bool(re.match(r"^\d{4}[-–]\d{2}", t))


def _is_remix_or_live_recording(title):
    t = title.lower()
    return any(w in t for w in [
        "remix", "live", "mix", "cover", "edit", "version", "demo",
        "instrumental", "acoustic", "radio", "extended", "bonus",
        "karaoke", "tribute", "parody",
    ]) and not any(w in t for w in ["radio edit", "album version"])


def _score_recording(rec):
    title = rec.get("title", "")
    releases = rec.get("release-list", [])
    score = 0
    if not _is_remix_or_live_recording(title):
        score += 200
    for rel in releases:
        rg = rel.get("release-group", {})
        rtype = rg.get("type", "").lower() if isinstance(rg, dict) else ""
        rtitle = rel.get("title", "")
        if rtype == "album":
            score += 50
        if not _is_bad_release(rtitle):
            score += 20
    return score


def _pick_best_release(releases, recording_id):
    if not releases:
        return None
    scored = []
    for rel in releases:
        rg = rel.get("release-group", {})
        rtype = rg.get("type", "").lower() if isinstance(rg, dict) else ""
        rtitle = rel.get("title", "")
        date = rel.get("date", "9999")[:4] if rel.get("date") else "9999"
        score = 0
        if rtype == "album":
            score += 100
        if not _is_bad_release(rtitle):
            score += 50
        if "compilation" not in rtype:
            score += 30
        if date != "9999":
            score += 10
        for medium in rel.get("medium-list", []):
            for track in medium.get("track-list", []):
                if track.get("recording", {}).get("id") == recording_id:
                    score += 200
                    break
        scored.append((score, date, rel))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return scored[0][2] if scored else releases[0]


def _get_genre(recording_id):
    if not recording_id or not musicbrainzngs:
        return ""
    try:
        detail = musicbrainzngs.get_recording_by_id(recording_id, includes=["genres"])
        genres = detail.get("recording", {}).get("genre-list", [])
        if genres:
            top = sorted(genres, key=lambda g: int(g.get("count", 0)), reverse=True)[:2]
            return ", ".join(g.get("name", "") for g in top)
    except Exception:
        pass
    try:
        detail = musicbrainzngs.get_recording_by_id(recording_id, includes=["tags"])
        tags = detail.get("recording", {}).get("tag-list", [])
        music_genres = [
            "rock", "pop", "hip hop", "rap", "jazz", "blues", "classical",
            "electronic", "dance", "r&b", "soul", "funk", "metal", "punk",
            "country", "folk", "reggae", "latin", "indie", "alternative",
            "progressive rock", "hard rock", "soft rock", "grunge", "synthpop",
            "techno", "house", "drum and bass", "dubstep", "trance",
            "ambient", "chillout", "trip hop", "lo-fi", "lofi",
            "soundtrack", "world", "new age", "grime", "emo", "ska",
            "swing", "big band", "disco", "garage rock", "psychedelic",
            "shoegaze", "post-punk", "dream pop", "art rock",
        ]
        music_tags = []
        for t in sorted(tags, key=lambda t: int(t.get("count", 0)), reverse=True):
            name = t.get("name", "").lower().strip()
            if name in music_genres and len(music_tags) < 2:
                music_tags.append(t.get("name", "").strip())
        if music_tags:
            return ", ".join(music_tags)
    except Exception:
        pass
    return ""


def search_musicbrainz(artist, title, limit=5):
    if not musicbrainzngs:
        return {"error": "musicbrainzngs not installed"}
    init_mb()
    if not artist and not title:
        return {"candidates": []}

    query_parts = []
    if artist:
        query_parts.append(f'artist:"{artist}"')
    if title:
        query_parts.append(f'recording:"{title}"')
    query = " AND ".join(query_parts)

    # Fetch more results than needed so we can rank and pick the best
    recordings = []
    try:
        result = musicbrainzngs.search_recordings(query=query, limit=25)
        recordings = result.get("recording-list", [])
    except Exception:
        pass
    if not recordings and artist:
        try:
            result = musicbrainzngs.search_recordings(query=f'recording:"{title}"', limit=25)
            recordings = result.get("recording-list", [])
        except Exception:
            pass
    if not recordings:
        return {"candidates": []}

    # Rank recordings: prefer ones that appear on proper studio albums
    ranked = sorted(recordings, key=lambda r: -_score_recording(r))

    seen = set()
    candidates = []
    for rec in ranked:
        rid = rec.get("id", "")
        if rid in seen:
            continue
        seen.add(rid)

        cand = {
            "recording_id": rid,
            "title": rec.get("title", ""),
            "artist": "",
            "artist_id": "",
            "album": "",
            "release_id": "",
            "year": "",
            "track_number": "",
            "genre": "",
            "cover_art_url": "",
        }

        ac = rec.get("artist-credit", [])
        if ac:
            cand["artist"] = ac[0].get("name", "")
            cand["artist_id"] = ac[0].get("artist", {}).get("id", "")

        best = _pick_best_release(rec.get("release-list", []), rid)
        if best:
            cand["album"] = best.get("title", "")
            cand["release_id"] = best.get("id", "")
            date = best.get("date", "")
            if date:
                cand["year"] = date[:4]
            for medium in best.get("medium-list", []):
                for track in medium.get("track-list", []):
                    if track.get("recording", {}).get("id") == rid:
                        cand["track_number"] = track.get("position", "")
                        break

        cand["genre"] = _get_genre(rid)

        if cand["release_id"]:
            cand["cover_art_url"] = f"https://coverartarchive.org/release/{cand['release_id']}/front-250"

        candidates.append(cand)
        if len(candidates) >= limit:
            break

    return {"candidates": candidates}


# ─── Cover Art ────────────────────────────────────────────────────

def fetch_cover_art(release_id):
    if not release_id or not requests:
        return None
    url = f"https://coverartarchive.org/release/{release_id}/front-500"
    try:
        resp = requests.get(url, timeout=10)
        if resp.status_code == 200:
            return resp.content
    except Exception:
        pass
    return None


# ─── Lyrics ───────────────────────────────────────────────────────

def fetch_lyrics(artist, title):
    if not requests:
        return None
    url = "https://lrclib.net/api/search"
    try:
        resp = requests.get(url, params={"q": f"{artist} {title}"}, timeout=10)
        if resp.status_code == 200:
            results = resp.json()
            if results and isinstance(results, list):
                for r in results:
                    lyric = r.get("syncedLyrics") or r.get("plainLyrics")
                    if lyric:
                        return lyric.strip()
    except Exception:
        pass
    return None


# ─── Tag Writing ──────────────────────────────────────────────────

def apply_metadata(filepath, meta):
    if MP3 is None:
        return {"error": "mutagen not installed"}
    path = Path(filepath)
    if not path.exists():
        return {"error": f"file not found: {filepath}"}
    ext = path.suffix.lower()
    try:
        if ext == ".mp3":
            return _apply_mp3(path, meta)
        elif ext == ".flac":
            return _apply_flac(path, meta)
        else:
            return _apply_generic(path, meta)
    except Exception as e:
        return {"error": str(e)}


def _apply_mp3(path, meta):
    try:
        audio = MP3(str(path))
    except Exception:
        return {"error": f"cannot open MP3: {path}"}
    tags = audio.tags
    if tags is None:
        tags = ID3()
        audio.tags = tags
    written = []
    if meta.get("title"):
        tags.add(TIT2(encoding=3, text=[meta["title"]])); written.append("title")
    if meta.get("artist"):
        tags.add(TPE1(encoding=3, text=[meta["artist"]])); written.append("artist")
    aa = meta.get("album_artist") or meta.get("artist")
    if aa:
        tags.add(TPE2(encoding=3, text=[aa])); written.append("album_artist")
    if meta.get("album"):
        tags.add(TALB(encoding=3, text=[meta["album"]])); written.append("album")
    if meta.get("year"):
        tags.add(TDRC(encoding=3, text=[meta["year"]])); written.append("year")
    if meta.get("track_number"):
        tags.add(TRCK(encoding=3, text=[str(meta["track_number"])])); written.append("track_number")
    if meta.get("genre"):
        tags.add(TCON(encoding=3, text=[meta["genre"]])); written.append("genre")
    if meta.get("lyrics"):
        tags.add(USLT(encoding=3, lang="eng", desc="Lyrics", text=meta["lyrics"])); written.append("lyrics")
    audio.save()
    return {"tags_written": written}


def _apply_flac(path, meta):
    audio = FLAC(str(path))
    written = []
    if meta.get("title"):
        audio["title"] = [meta["title"]]; written.append("title")
    if meta.get("artist"):
        audio["artist"] = [meta["artist"]]; written.append("artist")
    aa = meta.get("album_artist") or meta.get("artist")
    if aa:
        audio["albumartist"] = [aa]; written.append("album_artist")
    if meta.get("album"):
        audio["album"] = [meta["album"]]; written.append("album")
    if meta.get("year"):
        audio["date"] = [meta["year"]]; written.append("year")
    if meta.get("track_number"):
        audio["tracknumber"] = [str(meta["track_number"])]; written.append("track_number")
    if meta.get("genre"):
        audio["genre"] = [meta["genre"]]; written.append("genre")
    if meta.get("lyrics"):
        audio["lyrics"] = [meta["lyrics"]]; written.append("lyrics")
    if meta.get("recording_id"):
        audio["MUSICBRAINZ_TRACKID"] = [meta["recording_id"]]; written.append("mb_recording_id")
    if meta.get("artist_id"):
        audio["MUSICBRAINZ_ARTISTID"] = [meta["artist_id"]]; written.append("mb_artist_id")
    if meta.get("release_id"):
        audio["MUSICBRAINZ_ALBUMID"] = [meta["release_id"]]; written.append("mb_release_id")
    audio.save()
    return {"tags_written": written}


def _apply_generic(path, meta):
    audio = MutagenFile(str(path))
    if audio is None:
        return {"error": f"unsupported format: {path}"}
    written = []
    for key, tag in [("title", "title"), ("artist", "artist"), ("album", "album"), ("genre", "genre")]:
        if meta.get(key) and hasattr(audio, "__setitem__"):
            audio[tag] = meta[key]; written.append(tag)
    audio.save()
    return {"tags_written": written}


def embed_cover_art(filepath, image_data):
    if MP3 is None:
        return {"error": "mutagen not installed"}
    path = Path(filepath)
    ext = path.suffix.lower()
    try:
        if ext == ".mp3":
            audio = MP3(str(path))
            tags = audio.tags
            if tags is None:
                tags = ID3()
                audio.tags = tags
            tags.delall("APIC")
            mime = "image/png" if image_data[:4] == b"\x89PNG" else "image/jpeg"
            tags.add(APIC(encoding=3, mime=mime, type=3, desc="Cover", data=image_data))
            audio.save()
            return {"cover_embedded": True}
        elif ext == ".flac":
            audio = FLAC(str(path))
            pic = Picture()
            pic.type = 3
            pic.mime = "image/png" if image_data[:4] == b"\x89PNG" else "image/jpeg"
            pic.data = image_data
            audio.add_picture(pic)
            audio.save()
            return {"cover_embedded": True}
    except Exception as e:
        return {"error": str(e)}
    return {"error": f"unsupported format for cover art: {ext}"}


# ─── CLI ──────────────────────────────────────────────────────────

def cmd_search(args):
    if len(args) < 1:
        return {"error": "usage: enrich.py search <raw_title>"}
    parsed = parse_title(args[0])
    if not parsed["title"] and not parsed["artist"]:
        return {"parsed": parsed, "candidates": []}
    result = search_musicbrainz(parsed["artist"], parsed["title"])
    result["parsed"] = parsed
    return result


def cmd_search_mb(args):
    if len(args) < 2:
        return {"error": "usage: enrich.py search-mb <artist> <title>"}
    limit = int(args[2]) if len(args) > 2 else 5
    return search_musicbrainz(args[0], args[1], limit)


def cmd_enrich(args):
    if len(args) < 2:
        return {"error": "usage: enrich.py enrich <filepath> <json_metadata>"}
    filepath = args[0]
    meta = json.loads(args[1])
    results = {}

    results["tags"] = apply_metadata(filepath, meta)

    if meta.get("release_id"):
        cover_data = fetch_cover_art(meta["release_id"])
        if cover_data:
            results["cover"] = embed_cover_art(filepath, cover_data)
        else:
            results["cover"] = {"cover_embedded": False, "reason": "no cover found"}

    if meta.get("artist") and meta.get("title"):
        lyrics = fetch_lyrics(meta["artist"], meta["title"])
        if lyrics:
            apply_metadata(filepath, {"lyrics": lyrics})
            results["lyrics"] = {"found": True, "length": len(lyrics)}
        else:
            results["lyrics"] = {"found": False}

    return results


def cmd_cover(args):
    if len(args) < 1:
        return {"error": "usage: enrich.py cover <release_id>"}
    data = fetch_cover_art(args[0])
    if data:
        return {"found": True, "size_bytes": len(data)}
    return {"found": False}


COMMANDS = {
    "search": cmd_search,
    "search-mb": cmd_search_mb,
    "enrich": cmd_enrich,
    "cover": cmd_cover,
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(json.dumps({"error": f"usage: enrich.py <{'|'.join(COMMANDS)}> [args...]"}))
        sys.exit(1)
    print(json.dumps(COMMANDS[sys.argv[1]](sys.argv[2:]), ensure_ascii=False))


if __name__ == "__main__":
    main()
