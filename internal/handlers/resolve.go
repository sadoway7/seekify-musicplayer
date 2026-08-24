package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"musicapp/internal/downloads"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func parseVideoTitle(title, channel string) (string, string) {
	original := title

	replacements := []string{
		"(Official Music Video)", "(Official Video)", "(Official Audio)",
		"(Official HD Video)", "(Official)", "[Official Video]", "[Official Audio]",
		"(Music Video)", "[Music Video]", "(HD)", "[HD]", "(HQ)", "[HQ]",
		"(Lyric Video)", "(Lyrics)", "[Lyrics]", "(Audio)", "[Audio]",
		"(Visualizer)", "[Visualizer]", "(Animated Video)",
		" - Official Music Video", " - Official Video", " - Official Audio",
		" | Official Music Video", " | Official Video",
		"(Official Lyric Video)", "(Official Visualiser)", "[Official Lyric Video]",
		"(Official Visualiser)", "(Official Lyric Visualizer)",
		"(Color Coded Lyrics)", "(CC Lyrics)",
		"【Official Music Video】", "【Official Video】", "【Official Audio】",
		"『Official Music Video』",
	}

	for _, suffix := range replacements {
		re := strings.NewReplacer(
			suffix, "",
			strings.ToLower(suffix), "",
			strings.ToUpper(suffix), "",
		)
		title = re.Replace(title)
	}

	title = strings.ReplaceAll(title, "  ", " ")
	title = strings.TrimSpace(title)

	if strings.Contains(original, " - ") {
		parts := strings.SplitN(original, " - ", 2)
		if len(parts) == 2 {
			left := strings.TrimSpace(parts[0])
			right := strings.TrimSpace(parts[1])
			for _, suffix := range replacements {
				right = strings.ReplaceAll(right, suffix, "")
			}
			right = strings.TrimSpace(right)
			if left != "" && right != "" {
				return left, right
			}
		}
	}

	if strings.Contains(original, " – ") {
		parts := strings.SplitN(original, " – ", 2)
		if len(parts) == 2 {
			left := strings.TrimSpace(parts[0])
			right := strings.TrimSpace(parts[1])
			for _, suffix := range replacements {
				right = strings.ReplaceAll(right, suffix, "")
			}
			right = strings.TrimSpace(right)
			if left != "" && right != "" {
				return left, right
			}
		}
	}

	if channel != "" {
		cleaned := cleanChannelArtist(channel)
		if cleaned == "" {
			cleaned = strings.TrimSpace(channel)
		}
		return cleaned, title
	}

	return channel, title
}

func cleanChannelArtist(artist string) string {
	artist = strings.TrimSpace(artist)
	artist = strings.TrimSuffix(artist, " - Topic")
	artist = strings.TrimSuffix(artist, " Topic")
	artist = strings.TrimSuffix(artist, "VEVO")
	for _, suffix := range []string{"VEVO", " - Topic", " Topic", " Official", " Music"} {
		if strings.HasSuffix(artist, suffix) {
			artist = strings.TrimSuffix(artist, suffix)
		}
	}
	lower := strings.ToLower(artist)
	generic := []string{"music", "songs", "lyrics", "vevo", "official", "topic", "various", "unknown"}
	for _, g := range generic {
		if lower == g {
			return ""
		}
	}
	return strings.TrimSpace(artist)
}

func findPython3() string {
	for _, p := range []string{"python3", "/usr/bin/python3", "/usr/local/bin/python3", "/opt/homebrew/bin/python3"} {
		if path, err := exec.LookPath(p); err == nil {
			return path
		}
	}
	return ""
}

func EnrichWithPython(audioFile string, job *downloads.DownloadJob) {
	pythonPath := findPython3()
	if pythonPath == "" {
		log.Printf("[v2-enrich] python3 not found, skipping enrichment")
		downloads.TagAudioFile(audioFile, job.Artist, job.Title, job.Album, job.TrackNumber, job.TrackTotal)
		return
	}

	scriptPath := "scripts/enrich.py"
	if _, err := os.Stat(scriptPath); err != nil {
		candidates := []string{}
		if exe, _ := os.Executable(); exe != "" {
			candidates = append(candidates, filepath.Join(filepath.Dir(exe), "scripts", "enrich.py"))
		}
		found := false
		for _, p := range candidates {
			if _, err := os.Stat(p); err == nil {
				scriptPath = p
				found = true
				break
			}
		}
		if !found {
			log.Printf("[v2-enrich] scripts/enrich.py not found, falling back to ffmpeg tagging")
			downloads.TagAudioFile(audioFile, job.Artist, job.Title, job.Album, job.TrackNumber, job.TrackTotal)
			return
		}
	}

	meta := map[string]string{
		"artist":       job.Artist,
		"title":        job.Title,
		"album":        job.Album,
		"album_artist": job.Artist,
	}
	if job.Year != "" {
		meta["year"] = job.Year
	}
	if job.TrackNumber > 0 {
		meta["track_number"] = fmt.Sprintf("%d", job.TrackNumber)
	}
	if job.Genre != "" {
		meta["genre"] = job.Genre
	}
	if job.RecordingID != "" {
		meta["recording_id"] = job.RecordingID
	}
	if job.ArtistID != "" {
		meta["artist_id"] = job.ArtistID
	}
	if job.ReleaseID != "" {
		meta["release_id"] = job.ReleaseID
	}

	metaJSON, _ := json.Marshal(meta)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, pythonPath, scriptPath, "enrich", audioFile, string(metaJSON))
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("[v2-enrich] Python enrich failed: %v — %s", err, string(output))
		downloads.TagAudioFile(audioFile, job.Artist, job.Title, job.Album, job.TrackNumber, job.TrackTotal)
		return
	}

	var result map[string]interface{}
	if err := json.Unmarshal(output, &result); err == nil {
		log.Printf("[v2-enrich] Enrichment result: %s", string(output))
	} else {
		log.Printf("[v2-enrich] Could not parse enrich output: %s", string(output))
	}
}
