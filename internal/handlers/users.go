package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"musicapp/internal/auth"
)

// AdminListUsers → {users: [...]} (admin only; route is RequireAdmin-wrapped).
func AdminListUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	users, err := auth.ListUsers()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to load users")
		return
	}
	out := make([]map[string]interface{}, 0, len(users))
	for _, u := range users {
		out = append(out, auth.PublicUser(u))
	}
	writeJSON(w, map[string]interface{}{"users": out})
}

// AdminCreateUser → creates a regular or admin user (admin only).
func AdminCreateUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
		Email    string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if body.Role != auth.RoleAdmin && body.Role != auth.RoleUser {
		body.Role = auth.RoleUser
	}
	u, err := auth.CreateUser(body.Username, body.Password, body.Role, body.Email)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, auth.PublicUser(u))
}

// AdminUserSubrouter dispatches /api/admin/users/:id[/password] by method:
//   PUT            /api/admin/users/:id         → update role/email/disabled
//   POST           /api/admin/users/:id/password → reset password
//   DELETE         /api/admin/users/:id         → delete user
func AdminUserSubrouter(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/admin/users/")
	id = strings.Trim(id, "/")
	if id == "" {
		writeJSONError(w, http.StatusBadRequest, "missing user id")
		return
	}
	switch {
	case strings.HasSuffix(r.URL.Path, "/password") && r.Method == http.MethodPost:
		adminResetPassword(w, r, id)
	case r.Method == http.MethodPut:
		adminUpdateUser(w, r, id)
	case r.Method == http.MethodDelete:
		adminDeleteUser(w, r, id)
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func adminUpdateUser(w http.ResponseWriter, r *http.Request, id string) {
	var body struct {
		Role     string  `json:"role"`
		Email    *string `json:"email"`
		Disabled *bool   `json:"disabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if body.Role != "" && body.Role != auth.RoleAdmin && body.Role != auth.RoleUser {
		writeJSONError(w, http.StatusBadRequest, "invalid role")
		return
	}
	// Last-admin guard: refuse to disable or demote the final admin.
	target, err := auth.GetUserByID(id)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "user not found")
		return
	}
	if target.Role == auth.RoleAdmin {
		n, _ := auth.CountAdmins()
		demoting := body.Role == auth.RoleUser
		if n <= 1 && (demoting || (body.Disabled != nil && *body.Disabled)) {
			writeJSONError(w, http.StatusConflict, "cannot disable or demote the last admin")
			return
		}
	}
	if err := auth.UpdateUser(id, auth.UserUpdate{Role: body.Role, Email: body.Email, Disabled: body.Disabled}); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if body.Disabled != nil && *body.Disabled {
		auth.DeleteSessionsForUser(id)
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func adminResetPassword(w http.ResponseWriter, r *http.Request, id string) {
	var body struct{ New string `json:"new"` }
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if err := auth.SetUserPassword(id, body.New); err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	// Invalidate existing sessions so the user must log in with the new password.
	auth.DeleteSessionsForUser(id)
	writeJSON(w, map[string]bool{"ok": true})
}

func adminDeleteUser(w http.ResponseWriter, r *http.Request, id string) {
	target, err := auth.GetUserByID(id)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "user not found")
		return
	}
	if target.Role == auth.RoleAdmin {
		if n, _ := auth.CountAdmins(); n <= 1 {
			writeJSONError(w, http.StatusConflict, "cannot delete the last admin")
			return
		}
	}
	auth.DeleteSessionsForUser(id)
	if err := auth.DeleteUser(id); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}
