package auth

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"time"

	"musicapp/internal/store"
)

var ErrUserNotFound = errors.New("user not found")

func newUserID() string {
	b := make([]byte, 12)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func nullIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

type rowScanner interface {
	Scan(dest ...interface{}) error
}

const userCols = "id, username, password_hash, role, email, disabled, created_at"

func scanUser(s rowScanner) (*User, error) {
	u := &User{}
	var disabled int
	var email sql.NullString
	if err := s.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &email, &disabled, &u.CreatedAt); err != nil {
		return nil, err
	}
	u.Disabled = disabled != 0
	if email.Valid {
		u.Email = email.String
	}
	return u, nil
}

func CreateUser(username, password, role, email string) (*User, error) {
	if err := ValidateCredentials(username, password); err != nil {
		return nil, err
	}
	hash, err := HashPassword(password)
	if err != nil {
		return nil, err
	}
	u := &User{
		ID: newUserID(), Username: username, Role: role, Email: email,
		CreatedAt: time.Now().Unix(), PasswordHash: hash,
	}
	_, err = store.DB.Exec(
		`INSERT INTO users(id, username, password_hash, role, email, disabled, created_at) VALUES(?,?,?,?,?,?,?)`,
		u.ID, u.Username, u.PasswordHash, u.Role, nullIfEmpty(u.Email), 0, u.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func GetUserByID(id string) (*User, error) {
	row := store.DB.QueryRow(`SELECT `+userCols+` FROM users WHERE id=?`, id)
	u, err := scanUser(row)
	if err != nil {
		return nil, ErrUserNotFound
	}
	return u, nil
}

func GetUserByUsername(name string) (*User, error) {
	row := store.DB.QueryRow(`SELECT `+userCols+` FROM users WHERE username=?`, name)
	u, err := scanUser(row)
	if err != nil {
		return nil, ErrUserNotFound
	}
	return u, nil
}

func CountUsers() (int, error) {
	var n int
	err := store.DB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

func CountAdmins() (int, error) {
	var n int
	err := store.DB.QueryRow(`SELECT COUNT(*) FROM users WHERE role=? AND disabled=0`, RoleAdmin).Scan(&n)
	return n, err
}

// UserUpdate describes mutable fields. Only non-nil fields are applied.
type UserUpdate struct {
	Role     string
	Email    *string
	Disabled *bool
}

func UpdateUser(id string, upd UserUpdate) error {
	if upd.Role != "" {
		if _, err := store.DB.Exec(`UPDATE users SET role=? WHERE id=?`, upd.Role, id); err != nil {
			return err
		}
	}
	if upd.Email != nil {
		if _, err := store.DB.Exec(`UPDATE users SET email=? WHERE id=?`, nullIfEmpty(*upd.Email), id); err != nil {
			return err
		}
	}
	if upd.Disabled != nil {
		v := 0
		if *upd.Disabled {
			v = 1
		}
		if _, err := store.DB.Exec(`UPDATE users SET disabled=? WHERE id=?`, v, id); err != nil {
			return err
		}
	}
	return nil
}

func SetUserPassword(id, password string) error {
	if len(password) < 8 {
		return ErrPasswordTooShort
	}
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	_, err = store.DB.Exec(`UPDATE users SET password_hash=? WHERE id=?`, hash, id)
	return err
}

// DeleteUser refuses to delete the last enabled admin account.
func DeleteUser(id string) error {
	target, err := GetUserByID(id)
	if err != nil {
		return err
	}
	if target.Role == RoleAdmin {
		if n, err := CountAdmins(); err != nil {
			return err
		} else if n <= 1 {
			return errors.New("cannot delete the last admin account")
		}
	}
	_, err = store.DB.Exec(`DELETE FROM users WHERE id=?`, id)
	return err
}

func ListUsers() ([]*User, error) {
	rows, err := store.DB.Query(`SELECT ` + userCols + ` FROM users ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, nil
}
