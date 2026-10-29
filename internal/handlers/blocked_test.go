package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"musicapp/internal/auth"
)

// Thumbs-down ("never for me") mirrors the favorites endpoints: POST toggles
// per-user, GET lists the caller's blocked track ids.
func TestBlockedToggleAndList(t *testing.T) {
	req, _ := setupCollectionsTest(t)

	rec := callHandler(t, BlockedToggleHandler, req(http.MethodPost, "/api/blocked/t1", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("toggle on: status = %d (body: %s)", rec.Code, rec.Body.String())
	}
	var on struct {
		Added bool `json:"added"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &on); err != nil {
		t.Fatalf("decode toggle response: %v", err)
	}
	if !on.Added {
		t.Fatal("first toggle should add")
	}

	rec = callHandler(t, BlockedHandler, req(http.MethodGet, "/api/blocked", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("list: status = %d (body: %s)", rec.Code, rec.Body.String())
	}
	var list []string
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(list) != 1 || list[0] != "t1" {
		t.Fatalf("blocked list = %v, want [t1]", list)
	}

	rec = callHandler(t, BlockedToggleHandler, req(http.MethodPost, "/api/blocked/t1", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("toggle off: status = %d (body: %s)", rec.Code, rec.Body.String())
	}
	var off struct {
		Added bool `json:"added"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &off); err != nil {
		t.Fatalf("decode toggle-off response: %v", err)
	}
	if off.Added {
		t.Fatal("second toggle should remove")
	}

	rec = callHandler(t, BlockedHandler, req(http.MethodGet, "/api/blocked", ""))
	list = nil
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode empty list: %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("blocked list after untoggle = %v, want empty", list)
	}
}

// Blocked lists are strictly per-user: A's blocks never leak into B's list,
// and both users can hold (and release) the same track independently.
func TestBlockedPerUserIsolation(t *testing.T) {
	reqA, _ := setupCollectionsTest(t)

	bob, err := auth.CreateUser("bob", "password123", auth.RoleUser, "")
	if err != nil {
		t.Fatalf("create bob: %v", err)
	}
	bobToken, err := auth.CreateSession(bob.ID, "test", "test")
	if err != nil {
		t.Fatalf("create bob session: %v", err)
	}
	reqB := func(method, path, body string) *http.Request {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: bobToken})
		return req
	}

	blockedList := func(req func(string, string, string) *http.Request) []string {
		t.Helper()
		rec := callHandler(t, BlockedHandler, req(http.MethodGet, "/api/blocked", ""))
		var list []string
		if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
			t.Fatalf("decode list: %v", err)
		}
		return list
	}

	// A blocks t9 — B's list must not contain it.
	callHandler(t, BlockedToggleHandler, reqA(http.MethodPost, "/api/blocked/t9", ""))
	if got := blockedList(reqA); len(got) != 1 || got[0] != "t9" {
		t.Fatalf("A's list = %v, want [t9]", got)
	}
	if got := blockedList(reqB); len(got) != 0 {
		t.Fatalf("B's list = %v after A blocked t9, want empty (per-user isolation)", got)
	}

	// B blocks the same track — both lists hold it independently.
	callHandler(t, BlockedToggleHandler, reqB(http.MethodPost, "/api/blocked/t9", ""))
	if got := blockedList(reqB); len(got) != 1 || got[0] != "t9" {
		t.Fatalf("B's list = %v, want [t9]", got)
	}

	// A unblocks — B's block survives.
	callHandler(t, BlockedToggleHandler, reqA(http.MethodPost, "/api/blocked/t9", ""))
	if got := blockedList(reqA); len(got) != 0 {
		t.Fatalf("A's list = %v after unblock, want empty", got)
	}
	if got := blockedList(reqB); len(got) != 1 || got[0] != "t9" {
		t.Fatalf("B's list = %v after A unblocked, want [t9] (independent)", got)
	}
}
