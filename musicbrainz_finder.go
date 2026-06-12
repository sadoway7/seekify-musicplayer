package main

import (
	"encoding/json"
	"fmt"
	"musicapp/internal/store"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

type FinderRecording struct {
	ID           string   `json:"id"`
	Title        string   `json:"title"`
	Artist       string   `json:"artist"`
	ArtistID     string   `json:"artistId,omitempty"`
	Album        string   `json:"album,omitempty"`
	AlbumID      string   `json:"albumId,omitempty"`
	Year         string   `json:"year,omitempty"`
	Country      string   `json:"country,omitempty"`
	Length       int      `json:"length,omitempty"`
	TrackCount   int      `json:"trackCount,omitempty"`
	Score        int      `json:"score"`
	Tags         []string `json:"tags,omitempty"`
	InLibrary    bool     `json:"inLibrary"`
}

type FinderArtist struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	SortName       string `json:"sortName,omitempty"`
	Disambiguation string `json:"disambiguation,omitempty"`
	Country        string `json:"country,omitempty"`
	Type           string `json:"type,omitempty"`
	Score          int    `json:"score"`
	ReleaseCount   int    `json:"releaseCount,omitempty"`
	InLibrary      bool   `json:"inLibrary"`
}

type FinderRelease struct {
	ID             string   `json:"id"`
	Title          string   `json:"title"`
	Artist         string   `json:"artist"`
	ArtistID       string   `json:"artistId,omitempty"`
	Year           string   `json:"year,omitempty"`
	Country        string   `json:"country,omitempty"`
	TrackCount     int      `json:"trackCount,omitempty"`
	Format         string   `json:"format,omitempty"`
	Type           string   `json:"type,omitempty"`
	Score          int      `json:"score"`
	InLibrary      bool     `json:"inLibrary"`
}

type FinderReleaseTrack struct {
	Position  int    `json:"position"`
	Title     string `json:"title"`
	Length    int    `json:"length,omitempty"`
	Artist    string `json:"artist,omitempty"`
	Recording string `json:"recordingId,omitempty"`
	InLibrary bool   `json:"inLibrary"`
}

type ArtistTrack struct {
	Title     string `json:"title"`
	Artist    string `json:"artist"`
	Album     string `json:"album"`
	AlbumID   string `json:"albumId"`
	Length    int    `json:"length"`
	Position  int    `json:"position"`
	Count     int    `json:"count"`
	InLibrary bool   `json:"inLibrary"`
}

func finderSearchRecordings(query string, limit int) ([]FinderRecording, error) {
	var results []FinderRecording

	luceneQuery := buildRecordingQuery(query)
	reqURL := fmt.Sprintf("%s/recording/?query=%s&fmt=json&limit=%d",
		mbBaseURL, url.QueryEscape(luceneQuery), limit)

	body, err := mbDoRequest(reqURL)
	if err != nil {
		return nil, err
	}

	var searchResp struct {
		Recordings []struct {
			ID           string `json:"id"`
			Title        string `json:"title"`
			Score        int    `json:"score"`
			Length       int    `json:"length"`
			ArtistCredit []struct {
				Name   string `json:"name"`
				Artist struct {
					ID string `json:"id"`
				} `json:"artist"`
			} `json:"artist-credit"`
			FirstReleaseDate string `json:"first-release-date"`
			Releases         []struct {
				ID     string `json:"id"`
				Title  string `json:"title"`
				Date   string `json:"date"`
				Country string `json:"country"`
				ReleaseGroup struct {
					Type string `json:"primary-type"`
				} `json:"release-group"`
			} `json:"releases"`
		} `json:"recordings"`
	}

	if err := json.Unmarshal(body, &searchResp); err != nil {
		return nil, fmt.Errorf("invalid response from MusicBrainz: %v", err)
	}

	libLookup := buildLibraryLookup()

	seen := map[string]bool{}
	for _, rec := range searchResp.Recordings {
		if rec.Score < 80 {
			continue
		}

		artistName := ""
		artistID := ""
		if len(rec.ArtistCredit) > 0 {
			artistName = rec.ArtistCredit[0].Name
			artistID = rec.ArtistCredit[0].Artist.ID
		}

		dedupKey := strings.ToLower(artistName + "|" + rec.Title)
		if seen[dedupKey] {
			continue
		}
		seen[dedupKey] = true

		albumName := ""
		albumID := ""
		year := ""
		rgType := ""

		bestScore := -999
		for _, rel := range rec.Releases {
			s := releaseTypePriority(rel.ReleaseGroup.Type)
			if isCompilationTitle(rel.Title) {
				s -= 5
			}
			if s > bestScore {
				bestScore = s
				albumName = rel.Title
				albumID = rel.ID
				rgType = rel.ReleaseGroup.Type
				if len(rel.Date) >= 4 {
					year = rel.Date[:4]
				}
			}
		}

		if year == "" && len(rec.FirstReleaseDate) >= 4 {
			year = rec.FirstReleaseDate[:4]
		}

		if rgType == "Compilation" || rgType == "Soundtrack" {
			if len(rec.Releases) > 0 {
				found := false
				for _, rel := range rec.Releases {
					if rel.ReleaseGroup.Type != "Compilation" && rel.ReleaseGroup.Type != "Soundtrack" {
						found = true
						break
					}
				}
				if !found {
					continue
				}
			}
		}

		inLibrary := isInLibrary(libLookup, artistName, rec.Title)

		results = append(results, FinderRecording{
			ID:        rec.ID,
			Title:     rec.Title,
			Artist:    artistName,
			ArtistID:  artistID,
			Album:     albumName,
			AlbumID:   albumID,
			Year:      year,
			Length:    rec.Length / 1000,
			Score:     rec.Score,
			InLibrary: inLibrary,
		})
	}

	if len(results) > limit {
		results = results[:limit]
	}

	return results, nil
}

func buildRecordingQuery(raw string) string {
	parts := strings.SplitN(raw, " - ", 2)
	if len(parts) == 2 {
		artist := strings.TrimSpace(parts[0])
		title := strings.TrimSpace(parts[1])
		return fmt.Sprintf(`artistname:"%s" AND recording:"%s"`, escapeLucene(artist), escapeLucene(title))
	}
	return raw
}

func finderSearchArtists(query string, limit int) ([]FinderArtist, error) {
	var results []FinderArtist

	reqURL := fmt.Sprintf("%s/artist/?query=%s&fmt=json&limit=%d", mbBaseURL, url.QueryEscape(query), limit)

	body, err := mbDoRequest(reqURL)
	if err != nil {
		return nil, err
	}

	var searchResp struct {
		Artists []struct {
			ID             string `json:"id"`
			Name           string `json:"name"`
			SortName       string `json:"sort-name"`
			Disambiguation string `json:"disambiguation"`
			Country        string `json:"country"`
			Type           string `json:"type"`
			Score          int    `json:"score"`
		} `json:"artists"`
	}

	if err := json.Unmarshal(body, &searchResp); err != nil {
		return nil, fmt.Errorf("invalid response from MusicBrainz: %v", err)
	}

	store.Mu.RLock()
	libraryArtists := map[string]bool{}
	for _, t := range store.Tracks {
		if t.Artist != "" {
			libraryArtists[strings.ToLower(t.Artist)] = true
		}
	}
	store.Mu.RUnlock()

	for _, a := range searchResp.Artists {
		inLibrary := libraryArtists[strings.ToLower(a.Name)]

		results = append(results, FinderArtist{
			ID:             a.ID,
			Name:           a.Name,
			SortName:       a.SortName,
			Disambiguation: a.Disambiguation,
			Country:        a.Country,
			Type:           a.Type,
			Score:          a.Score,
			InLibrary:      inLibrary,
		})
	}

	return results, nil
}

func finderSearchReleases(query string, limit int) ([]FinderRelease, error) {
	var results []FinderRelease

	luceneQuery := buildReleaseQuery(query)
	reqURL := fmt.Sprintf("%s/release/?query=%s&fmt=json&limit=%d",
		mbBaseURL, url.QueryEscape(luceneQuery), limit)

	body, err := mbDoRequest(reqURL)
	if err != nil {
		return nil, err
	}

	var searchResp struct {
		Releases []struct {
			ID     string `json:"id"`
			Title  string `json:"title"`
			Score  int    `json:"score"`
			Date   string `json:"date"`
			Country string `json:"country"`
			TrackCount int `json:"track-count"`
			ArtistCredit []struct {
				Name   string `json:"name"`
				Artist struct {
					ID string `json:"id"`
				} `json:"artist"`
			} `json:"artist-credit"`
			ReleaseGroup struct {
				Type string `json:"primary-type"`
				ID   string `json:"id"`
			} `json:"release-group"`
			Media []struct {
				Format string `json:"format"`
			} `json:"media"`
		} `json:"releases"`
	}

	if err := json.Unmarshal(body, &searchResp); err != nil {
		return nil, fmt.Errorf("invalid response from MusicBrainz: %v", err)
	}

	albumLookup := buildAlbumLookup()

	seen := map[string]bool{}
	for _, rel := range searchResp.Releases {
		if rel.Score < 80 {
			continue
		}

		artistName := ""
		artistID := ""
		if len(rel.ArtistCredit) > 0 {
			artistName = rel.ArtistCredit[0].Name
			artistID = rel.ArtistCredit[0].Artist.ID
		}

		if artistName == "" || strings.EqualFold(artistName, "Various Artists") {
			continue
		}

		rgType := rel.ReleaseGroup.Type
		if rgType == "Compilation" {
			continue
		}

		dedupKey := strings.ToLower(artistName + "|" + rel.Title)
		if seen[dedupKey] {
			continue
		}
		seen[dedupKey] = true

		year := ""
		if len(rel.Date) >= 4 {
			year = rel.Date[:4]
		}

		format := ""
		if len(rel.Media) > 0 {
			format = rel.Media[0].Format
		}

		inLibrary := albumLookup[strings.ToLower(artistName+"|"+rel.Title)]

		results = append(results, FinderRelease{
			ID:         rel.ID,
			Title:      rel.Title,
			Artist:     artistName,
			ArtistID:   artistID,
			Year:       year,
			TrackCount: rel.TrackCount,
			Format:     format,
			Type:       rgType,
			Score:      rel.Score,
			InLibrary:  inLibrary,
		})
	}

	if len(results) > limit {
		results = results[:limit]
	}

	return results, nil
}

func buildReleaseQuery(raw string) string {
	parts := strings.SplitN(raw, " - ", 2)
	if len(parts) == 2 {
		artist := strings.TrimSpace(parts[0])
		album := strings.TrimSpace(parts[1])
		return fmt.Sprintf(`artist:"%s" AND release:"%s"`, escapeLucene(artist), escapeLucene(album))
	}
	return raw
}

func finderArtistReleases(mbid string) ([]FinderRelease, error) {
	var results []FinderRelease

	var artistName string
	offset := 0
	for {
		reqURL := fmt.Sprintf("%s/release-group?artist=%s&fmt=json&limit=25&offset=%d&type=album",
			mbBaseURL, mbid, offset)

		body, err := mbDoRequest(reqURL)
		if err != nil {
			return nil, err
		}

		var resp struct {
			ReleaseGroups []struct {
				ID           string `json:"id"`
				Title        string `json:"title"`
				PrimaryType  string `json:"primary-type"`
				FirstRelease string `json:"first-release-date"`
				ArtistCredit []struct {
					Name   string `json:"name"`
					Artist struct {
						ID string `json:"id"`
					} `json:"artist"`
				} `json:"artist-credit"`
			} `json:"release-groups"`
			ReleaseGroupCount int `json:"release-group-count"`
		}

		if err := json.Unmarshal(body, &resp); err != nil {
			return nil, fmt.Errorf("invalid response from MusicBrainz: %v", err)
		}

		if artistName == "" && len(resp.ReleaseGroups) > 0 && len(resp.ReleaseGroups[0].ArtistCredit) > 0 {
			artistName = resp.ReleaseGroups[0].ArtistCredit[0].Name
		}

		for _, rg := range resp.ReleaseGroups {
			year := ""
			if len(rg.FirstRelease) >= 4 {
				year = rg.FirstRelease[:4]
			}

			results = append(results, FinderRelease{
				ID:       rg.ID,
				Title:    rg.Title,
				Artist:   artistName,
				ArtistID: mbid,
				Year:     year,
				Type:     rg.PrimaryType,
			})
		}

		offset += len(resp.ReleaseGroups)
		if len(results) >= 50 || offset >= resp.ReleaseGroupCount || len(resp.ReleaseGroups) == 0 {
			break
		}
		time.Sleep(300 * time.Millisecond)
	}

	sort.Slice(results, func(i, j int) bool {
		yi, _ := strconv.Atoi(results[i].Year)
		yj, _ := strconv.Atoi(results[j].Year)
		if yi != yj {
			return yj < yi
		}
		return results[i].Title < results[j].Title
	})

	return results, nil
}

func finderReleaseTracks(idOrRGID string) ([]FinderReleaseTrack, error) {
	var tracks []FinderReleaseTrack

	releaseID := resolveToReleaseID(idOrRGID)
	if releaseID == "" {
		return nil, fmt.Errorf("could not resolve release for %s", idOrRGID)
	}

	reqURL := fmt.Sprintf("%s/release/%s?inc=recordings+artist-credits&fmt=json", mbBaseURL, releaseID)

	body, err := mbDoRequest(reqURL)
	if err != nil {
		return nil, err
	}

	var resp struct {
		Title string `json:"title"`
		Media []struct {
			Tracks []struct {
				Position  int    `json:"position"`
				Title     string `json:"title"`
				Length    int    `json:"length"`
				Recording struct {
					ID string `json:"id"`
				} `json:"recording"`
				ArtistCredit []struct {
					Name string `json:"name"`
				} `json:"artist-credit"`
			} `json:"tracks"`
		} `json:"media"`
	}

	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("invalid response from MusicBrainz: %v", err)
	}

	libLookup := buildLibraryLookup()

	for _, m := range resp.Media {
		for _, t := range m.Tracks {
			artist := ""
			if len(t.ArtistCredit) > 0 {
				artist = t.ArtistCredit[0].Name
			}
			tracks = append(tracks, FinderReleaseTrack{
				Position:  t.Position,
				Title:     t.Title,
				Length:    t.Length / 1000,
				Artist:    artist,
				Recording: t.Recording.ID,
				InLibrary: isInLibrary(libLookup, artist, t.Title),
			})
		}
	}

	return tracks, nil
}

func resolveToReleaseID(id string) string {
	reqURL := fmt.Sprintf("%s/release/%s?fmt=json", mbBaseURL, id)
	body, err := mbDoRequest(reqURL)
	if err == nil {
		var check struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(body, &check) == nil && check.ID == id {
			return id
		}
	}

	reqURL = fmt.Sprintf("%s/release?release-group=%s&fmt=json&limit=1&status=official", mbBaseURL, id)
	body, err = mbDoRequest(reqURL)
	if err != nil {
		reqURL = fmt.Sprintf("%s/release?release-group=%s&fmt=json&limit=1", mbBaseURL, id)
		body, err = mbDoRequest(reqURL)
		if err != nil {
			return ""
		}
	}
	var resp struct {
		Releases []struct {
			ID string `json:"id"`
		} `json:"releases"`
	}
	if json.Unmarshal(body, &resp) != nil || len(resp.Releases) == 0 {
		return ""
	}
	return resp.Releases[0].ID
}

func finderArtistTracks(mbid, artistName string) []ArtistTrack {
	seen := map[string]*ArtistTrack{}
	libLookup := buildLibraryLookup()

	offset := 0
	for {
		reqURL := fmt.Sprintf("%s/recording?artist=%s&inc=artist-credits&fmt=json&limit=100&offset=%d",
			mbBaseURL, mbid, offset)

		var body []byte
		var lastErr error
		for retry := 0; retry < 3; retry++ {
			if retry > 0 {
				time.Sleep(time.Duration(retry) * 1100 * time.Millisecond)
			}
			body, lastErr = mbDoRequest(reqURL)
			if lastErr == nil {
				break
			}
		}
		if lastErr != nil {
			break
		}

		var resp struct {
			Recordings     []json.RawMessage `json:"recordings"`
			RecordingCount int               `json:"recording-count"`
		}
		if json.Unmarshal(body, &resp) != nil {
			break
		}

		for _, raw := range resp.Recordings {
			var rec struct {
				Title        string `json:"title"`
				Length       int    `json:"length"`
				Video        bool   `json:"video"`
				Disambiguation string `json:"disambiguation"`
				ArtistCredit []struct {
					Name string `json:"name"`
				} `json:"artist-credit"`
			}
			if json.Unmarshal(raw, &rec) != nil {
				continue
			}
			if rec.Video {
				continue
			}

			title := cleanTrackTitle(rec.Title)
			if title == "" || strings.HasPrefix(title, "[") {
				continue
			}

			key := strings.ToLower(title)
			length := rec.Length / 1000
			artist := artistName
			if len(rec.ArtistCredit) > 0 && rec.ArtistCredit[0].Name != "" {
				artist = rec.ArtistCredit[0].Name
			}
			artist = cleanChannelName(artist)

			if existing, ok := seen[key]; ok {
				existing.Count++
				if length > existing.Length && length > 0 {
					existing.Length = length
				}
			} else {
		seen[key] = &ArtistTrack{
				Title:     title,
				Artist:    artist,
				Length:    length,
				Count:     1,
				InLibrary: isInLibrary(libLookup, artist, title),
			}
			}
		}

		offset += len(resp.Recordings)
		if offset >= resp.RecordingCount || len(resp.Recordings) == 0 || offset >= 5000 {
			break
		}
		time.Sleep(750 * time.Millisecond)
	}

	var result []ArtistTrack
	for _, t := range seen {
		result = append(result, *t)
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].Count > result[j].Count
	})

	return result
}

func cleanChannelName(name string) string {
	name = strings.TrimSpace(name)
	name = strings.TrimSuffix(name, " - Topic")
	name = strings.TrimSuffix(name, " Topic")
	name = strings.TrimSuffix(name, "VEVO")
	return strings.TrimSpace(name)
}

func cleanTrackTitle(title string) string {
	title = strings.TrimSpace(title)
	if title == "" {
		return ""
	}

	for {
		rest := title
		rest = strings.TrimSuffix(rest, " (remix)")
		rest = strings.TrimSuffix(rest, " (Remix)")
		rest = strings.TrimSuffix(rest, " (radio edit)")
		rest = strings.TrimSuffix(rest, " (Radio Edit)")
		rest = strings.TrimSuffix(rest, " (radio version)")
		rest = strings.TrimSuffix(rest, " (live)")
		rest = strings.TrimSuffix(rest, " (Live)")
		rest = strings.TrimSuffix(rest, " (instrumental)")
		rest = strings.TrimSuffix(rest, " (Instrumental)")
		rest = strings.TrimSuffix(rest, " (edit)")
		rest = strings.TrimSuffix(rest, " (Edit)")
		rest = strings.TrimSuffix(rest, " (extended)")
		rest = strings.TrimSuffix(rest, " (Extended)")
		rest = strings.TrimSuffix(rest, " (dub)")
		rest = strings.TrimSuffix(rest, " (video)")
		rest = strings.TrimSuffix(rest, " (clean)")
		rest = strings.TrimSuffix(rest, " (acoustic)")
		rest = strings.TrimSuffix(rest, " (demo)")
		rest = strings.TrimSuffix(rest, " (promo)")
		rest = strings.TrimSuffix(rest, " (mix)")
		rest = strings.TrimSuffix(rest, " (single version)")
		rest = strings.TrimSuffix(rest, " (album version)")
		rest = strings.TrimSuffix(rest, " (LP version)")
		if rest == title {
			break
		}
		title = rest
	}

	title = strings.TrimSpace(title)
	return title
}
