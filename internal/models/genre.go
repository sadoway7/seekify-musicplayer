package models

import (
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// ponytail: normalize known spelling variants and preserve everything else;
// a closed list would lose legitimate subgenres.
var genreAliases = map[string]string{
	"alt rock":               "Alternative Rock",
	"alternative rock":       "Alternative Rock",
	"drum & bass":            "Drum & Bass",
	"drum and bass":          "Drum & Bass",
	"drum n bass":            "Drum & Bass",
	"d&b":                    "Drum & Bass",
	"dnb":                    "Drum & Bass",
	"edm":                    "EDM",
	"electronic dance music": "EDM",
	"hip hop":                "Hip-Hop",
	"hip-hop":                "Hip-Hop",
	"j pop":                  "J-Pop",
	"lo fi":                  "Lo-Fi",
	"lofi":                   "Lo-Fi",
	"r & b":                  "R&B",
	"r&b":                    "R&B",
	"rnb":                    "R&B",
	"rhythm & blues":         "R&B",
	"rhythm and blues":       "R&B",
	"two step":               "2-Step",
	"2 step":                 "2-Step",
	"uk garage":              "UK Garage",
	"ukg":                    "UK Garage",
	"uk house":               "UK House",
	"uk funky":               "UK Funky",
	"psy trance":             "Psytrance",
	"psytrance":              "Psytrance",
	"liquid drum and bass":   "Liquid Drum & Bass",
	"liquid drum & bass":     "Liquid Drum & Bass",
}

var id3GenreAliases = map[int]string{
	0:  "Blues",
	2:  "Country",
	5:  "Funk",
	7:  "Hip-Hop",
	8:  "Jazz",
	9:  "Metal",
	13: "Pop",
	14: "R&B",
	15: "Hip-Hop",
	16: "Reggae",
	17: "Rock",
	18: "Electronic",
}

// CanonicalGenres maps a raw tag string to a list of browseable canonical
// genres. Empty/junk parts are dropped and duplicates are removed.
func CanonicalGenres(raw string) []string {
	if strings.Contains(strings.ToLower(raw), "://") {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, part := range strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ';' || r == '/'
	}) {
		key := normalizeGenreKey(part)
		if key == "" {
			continue
		}
		if isJunkGenre(key) {
			continue
		}
		var genre string
		if n, err := strconv.Atoi(key); err == nil {
			if g, ok := id3GenreAliases[n]; ok {
				genre = g
			} else {
				continue
			}
		} else if g, ok := genreAliases[key]; ok {
			genre = g
		} else {
			genre = titleGenre(key)
		}
		if genre != "" && !seen[genre] {
			seen[genre] = true
			out = append(out, genre)
		}
	}
	return out
}

// CanonicalGenre returns the first canonical genre for backwards compatibility.
func CanonicalGenre(raw string) string {
	genres := CanonicalGenres(raw)
	if len(genres) == 0 {
		return ""
	}
	return genres[0]
}

func normalizeGenreKey(raw string) string {
	raw = strings.ToLower(strings.TrimSpace(raw))
	raw = strings.NewReplacer(".", "", "(", "", ")", "", "-", " ").Replace(raw)
	return strings.Join(strings.Fields(raw), " ")
}

func isJunkGenre(key string) bool {
	switch key {
	case "", "music", "other", "unknown", "unknown genre", "upbeat", "slow", "fast", "instrumental", "video", "official video":
		return true
	}
	if strings.Contains(key, "youtube") || strings.Contains(key, "download") {
		return true
	}
	if strings.HasSuffix(key, "s") {
		if n, err := strconv.Atoi(strings.TrimSuffix(key, "s")); err == nil && n >= 0 && n <= 99 {
			return true
		}
	}
	if n, err := strconv.Atoi(key); err == nil {
		return n >= 1900 && n <= 2100
	}
	return false
}

func titleGenre(key string) string {
	words := strings.Fields(key)
	for i, word := range words {
		switch word {
		case "edm":
			words[i] = "EDM"
			continue
		case "uk":
			words[i] = "UK"
			continue
		case "idm":
			words[i] = "IDM"
			continue
		case "ebm":
			words[i] = "EBM"
			continue
		}
		r, size := utf8.DecodeRuneInString(word)
		if r != utf8.RuneError || size != 0 {
			words[i] = string(unicode.ToUpper(r)) + word[size:]
		}
	}
	return strings.Join(words, " ")
}
