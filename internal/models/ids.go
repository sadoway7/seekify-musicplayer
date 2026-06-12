package models

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

func GenerateID(input string) string {
	h := sha256.Sum256([]byte(input))
	return hex.EncodeToString(h[:])[:12]
}

func GenerateUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func GenerateAlbumID(artist, album string) string {
	return GenerateID(strings.ToLower(artist + "|" + album))
}
