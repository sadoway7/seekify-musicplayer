package main

type Track struct {
	ID               string `json:"id"`
	Title            string `json:"title"`
	Artist           string `json:"artist"`
	Album            string `json:"album"`
	AlbumArtist      string `json:"albumArtist"`
	AlbumID          string `json:"albumID"`
	TrackNumber      int    `json:"trackNumber"`
	Year             int    `json:"year"`
	Genre            string `json:"genre"`
	Duration         int    `json:"duration"`
	FilePath         string `json:"filePath"`
	HasCover         bool   `json:"hasCover"`
	ModTime          int64  `json:"modTime"`
	MBID             string `json:"mbid,omitempty"`
	HasMetadata      bool   `json:"hasMetadata"`
	DownloadEnabled  bool   `json:"downloadEnabled"`
}

type Album struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Artist     string `json:"artist"`
	TrackCount int    `json:"trackCount"`
	Year       int    `json:"year"`
	HasCover   bool   `json:"hasCover"`
}

type Artist struct {
	Name       string `json:"name"`
	AlbumCount int    `json:"albumCount"`
	TrackCount int    `json:"trackCount"`
}

type LibraryResponse struct {
	Tracks  []Track  `json:"tracks"`
	Albums  []Album  `json:"albums"`
	Artists []Artist `json:"artists"`
}

type Playlist struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	TrackIDs  []string `json:"trackIds"`
	CreatedAt string   `json:"createdAt"`
}

type AppState struct {
	Playlists []Playlist `json:"playlists"`
	Favorites []string   `json:"favorites"`
	Recent    []string   `json:"recent"`
}

type ScanStats struct {
	Scanned int `json:"scanned"`
	Added   int `json:"added"`
	Removed int `json:"removed"`
}

type MetadataMatch struct {
	ID           string  `json:"id"`
	TrackID      string  `json:"trackId"`
	TrackTitle   string  `json:"trackTitle"`
	TrackArtist  string  `json:"trackArtist"`
	MBTitle      string  `json:"mbTitle"`
	MBArtist     string  `json:"mbArtist"`
	MBAlbum      string  `json:"mbAlbum"`
	MBAlbumID    string  `json:"mbAlbumId"`
	MBScore      float64 `json:"mbScore"`
	Status       string  `json:"status"`
	HasCover     bool    `json:"hasCover"`
	FilePath     string  `json:"filePath"`
}

type MetadataScanResult struct {
	Matched      int `json:"matched"`
	Pending      int `json:"pending"`
	Conflicts    int `json:"conflicts"`
	Failed       int `json:"failed"`
	AutoApproved int `json:"autoApproved"`
}
