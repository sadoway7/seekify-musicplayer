package handlers

import (
	"encoding/json"
	"net/http"

	"musicapp/internal/auth"
	"musicapp/internal/store"
)

// RegistrationModeHandler → {mode}. Public; lets the SPA decide whether to show
// the Register button. Only the mode is public — default_role is admin-only.
func RegistrationModeHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{"mode": store.GetSetting("registration_mode", "off")})
}

// RegisterHandler creates a user via the admin-configured registration_mode:
//   off          → 403
//   self_service → active user + session + cookie (200, like login)
//   approval     → pending user, no session (202 {pending:true})
func RegisterHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	mode := store.GetSetting("registration_mode", "off")
	if mode == "off" {
		writeJSONError(w, http.StatusForbidden, "registration is disabled")
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "bad request")
		return
	}
	role := store.GetSetting("default_role", auth.RoleUser)
	if role != auth.RoleAdmin && role != auth.RoleUser {
		role = auth.RoleUser
	}
	status := auth.StatusActive
	if mode == "approval" {
		status = auth.StatusPending
	}
	u, err := auth.CreateUserWithStatus(body.Username, body.Password, role, "", status)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	if status == auth.StatusPending {
		writeJSON(w, map[string]interface{}{"pending": true, "username": u.Username})
		return
	}
	tok, err := auth.CreateSession(u.ID, r.RemoteAddr, r.UserAgent())
	if err != nil {
		http.Error(w, "session error", http.StatusInternalServerError)
		return
	}
	auth.SetSessionCookie(w, tok)
	writeJSON(w, auth.PublicUser(u))
}

// AdminRegistrationSettingsHandler → GET {mode, default_role}; PUT {mode, default_role}.
func AdminRegistrationSettingsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, map[string]string{
			"mode":        store.GetSetting("registration_mode", "off"),
			"default_role": store.GetSetting("default_role", auth.RoleUser),
		})
	case http.MethodPut:
		var body struct {
			Mode       string `json:"mode"`
			DefaultRole string `json:"default_role"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		switch body.Mode {
		case "off", "self_service", "approval":
		default:
			writeJSONError(w, http.StatusBadRequest, "invalid mode")
			return
		}
		if body.DefaultRole != auth.RoleAdmin && body.DefaultRole != auth.RoleUser {
			writeJSONError(w, http.StatusBadRequest, "invalid default_role")
			return
		}
		store.SetSetting("registration_mode", body.Mode)
		store.SetSetting("default_role", body.DefaultRole)
		writeJSON(w, map[string]bool{"ok": true})
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
