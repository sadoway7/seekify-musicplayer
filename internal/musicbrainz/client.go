package musicbrainz

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

var MbClient = &http.Client{
	Timeout: 15 * time.Second,
	Transport: &http.Transport{
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ForceAttemptHTTP2:     true,
	},
}

const MbBaseURL = "https://musicbrainz.org/ws/2"
const CoverArtBaseURL = "https://coverartarchive.org"
const musicBrainzRequestInterval = 1100 * time.Millisecond

type MbSearchResponse struct {
	Releases []MbRelease `json:"releases"`
}

type MbRelease struct {
	ID         string          `json:"id"`
	Title      string          `json:"title"`
	Artist     []MbArtistCredit
	Date       string `json:"date"`
	TrackCount int    `json:"track-count"`
}

type MbArtistCredit struct {
	Name string `json:"name"`
}

type MbRecordingResult struct {
	RecordingID string
	ArtistID    string
	Title       string
	Artist      string
	Album       string
	AlbumID     string
	ReleaseType string
}

type MbRecording struct {
	Title        string `json:"title"`
	Length       int    `json:"length"`
	Video        bool   `json:"video"`
	ArtistCredit []struct {
		Name   string `json:"name"`
		Artist struct {
			ID string `json:"id"`
		} `json:"artist"`
	} `json:"artist-credit"`
	Releases []struct {
		Title string `json:"title"`
		ID    string `json:"id"`
	} `json:"releases"`
}

func MbDoRequest(reqURL string) ([]byte, error) {
	return MbDoRequestWithRetry(reqURL, 2)
}

func MbDoRequestWithRetry(reqURL string, retries int) ([]byte, error) {
	if _, err := reserveMusicBrainzSlot(musicbrainzRateFile(), musicBrainzRequestInterval); err != nil {
		return nil, fmt.Errorf("MusicBrainz rate gate: %v", err)
	}
	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Seekify/1.0 (https://github.com/sadoway7/seekify-musicplayer)")

	resp, err := MbClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode == 503 && retries > 0 {
		time.Sleep(1100 * time.Millisecond)
		return MbDoRequestWithRetry(reqURL, retries-1)
	}
	if resp.StatusCode == 503 {
		return nil, fmt.Errorf("rate limited by MusicBrainz (503)")
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("MusicBrainz returned HTTP %d", resp.StatusCode)
	}

	return body, nil
}

func musicbrainzRateFile() string {
	if path := os.Getenv("MUSICAPP_MB_RATE_FILE"); path != "" {
		return path
	}
	return filepath.Join("data", "music.db.mb-rate")
}

func reserveMusicBrainzSlot(path string, interval time.Duration) (time.Time, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return time.Time{}, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0644)
	if err != nil {
		return time.Time{}, err
	}
	defer f.Close()
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		return time.Time{}, err
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)

	data, _ := io.ReadAll(f)
	if next, err := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64); err == nil {
		if wait := time.Until(time.Unix(0, next)); wait > 0 {
			time.Sleep(wait)
		}
	}

	reserved := time.Now()
	if err := f.Truncate(0); err != nil {
		return time.Time{}, err
	}
	if _, err := f.Seek(0, 0); err != nil {
		return time.Time{}, err
	}
	if _, err := f.WriteString(strconv.FormatInt(reserved.Add(interval).UnixNano(), 10)); err != nil {
		return time.Time{}, err
	}
	return reserved, nil
}

func EscapeLucene(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	s = strings.ReplaceAll(s, `+`, `\+`)
	s = strings.ReplaceAll(s, `-`, `\-`)
	s = strings.ReplaceAll(s, `&&`, `\&&`)
	s = strings.ReplaceAll(s, `||`, `\||`)
	s = strings.ReplaceAll(s, `!`, `\!`)
	s = strings.ReplaceAll(s, `(`, `\(`)
	s = strings.ReplaceAll(s, `)`, `\)`)
	s = strings.ReplaceAll(s, `{`, `\{`)
	s = strings.ReplaceAll(s, `}`, `\}`)
	s = strings.ReplaceAll(s, `[`, `\[`)
	s = strings.ReplaceAll(s, `]`, `\]`)
	s = strings.ReplaceAll(s, `^`, `\^`)
	s = strings.ReplaceAll(s, `~`, `\~`)
	s = strings.ReplaceAll(s, `*`, `\*`)
	s = strings.ReplaceAll(s, `?`, `\?`)
	s = strings.ReplaceAll(s, `:`, `\:`)
	s = strings.ReplaceAll(s, `/`, `\/`)
	return s
}
