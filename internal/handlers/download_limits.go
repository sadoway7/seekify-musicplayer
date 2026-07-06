package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"musicapp/internal/store"
)

// AdminGetDownloadLimits → {global, perUser} (0 = unlimited).
func AdminGetDownloadLimits(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]int{
		"global":  store.GetSettingInt("download_limit_global", 0),
		"perUser": store.GetSettingInt("download_limit_per_user", 0),
	})
}

// AdminPutDownloadLimits sets both caps (0 = unlimited).
func AdminPutDownloadLimits(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Global  int `json:"global"`
		PerUser int `json:"perUser"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if body.Global < 0 || body.PerUser < 0 {
		writeJSONError(w, http.StatusBadRequest, "limits must be >= 0")
		return
	}
	store.SetSetting("download_limit_global", strconv.Itoa(body.Global))
	store.SetSetting("download_limit_per_user", strconv.Itoa(body.PerUser))
	writeJSON(w, map[string]int{"global": body.Global, "perUser": body.PerUser})
}
