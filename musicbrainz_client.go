package main

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

var mbClient = &http.Client{
	Timeout: 15 * time.Second,
	Transport: &http.Transport{
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ForceAttemptHTTP2:     true,
	},
}

const mbBaseURL = "https://musicbrainz.org/ws/2"
const coverArtBaseURL = "https://coverartarchive.org"

type mbSearchResponse struct {
	Releases []mbRelease `json:"releases"`
}

type mbRelease struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Artist  []mbArtistCredit
	Date    string `json:"date"`
	TrackCount int `json:"track-count"`
}

type mbArtistCredit struct {
	Name string `json:"name"`
}

type mbLookupResponse struct {
	Title       string `json:"title"`
	ArtistCredit []mbArtistCredit `json:"artist-credit"`
	Date        string `json:"date"`
}

type mbRecordingResult struct {
	RecordingID string
	Title       string
	Artist      string
	Album       string
	AlbumID     string
}

type mbRecording struct {
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

func mbDoRequest(reqURL string) ([]byte, error) {
	return mbDoRequestWithRetry(reqURL, 2)
}

func mbDoRequestWithRetry(reqURL string, retries int) ([]byte, error) {
	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "MusicApp/1.0 (personal music library)")

	resp, err := mbClient.Do(req)
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
		return mbDoRequestWithRetry(reqURL, retries-1)
	}
	if resp.StatusCode == 503 {
		return nil, fmt.Errorf("rate limited by MusicBrainz (503)")
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("MusicBrainz returned HTTP %d", resp.StatusCode)
	}

	return body, nil
}

func escapeLucene(s string) string {
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
