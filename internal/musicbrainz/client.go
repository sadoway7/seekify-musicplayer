package musicbrainz

import (
	"fmt"
	"io"
	"net/http"
	"strings"
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
	Title       string
	Artist      string
	Album       string
	AlbumID     string
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
	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "MusicApp/1.0 (personal music library)")

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
