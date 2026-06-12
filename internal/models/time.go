package models

import "time"

func TimeNow() string {
	return time.Now().UTC().Format(time.RFC3339)
}
