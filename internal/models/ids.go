package models

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"github.com/google/uuid"
)

func GenerateID(input string) string {
	h := sha256.Sum256([]byte(input))
	return hex.EncodeToString(h[:])[:12]
}

func GenerateUUID() string {
	return uuid.New().String()
}

func GenerateAlbumID(artist, album string) string {
	return GenerateID(strings.ToLower(artist + "|" + album))
}
