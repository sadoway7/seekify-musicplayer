//go:build desktop

// Seekify desktop entrypoint (Wails v3). Startup order is load-bearing:
// chdir into writable %APPDATA%\Seekify so every relative path the server
// uses (data/, .env) lands there; first-run folder picker if no library is
// configured; then the real server via runServer(false) — no browser
// auto-open, the window opens instead. Tray is the always-present control
// surface; closing the window hides to tray.
package main

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"log"
	"musicapp/internal/desktopconfig"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

//go:embed icon-rounded.png
var trayIcon []byte

type desktopApp struct {
	app         *application.App
	window      *application.WebviewWindow
	srv         *http.Server
	errCh       <-chan error
	port        string
	startHidden bool // autostart: stay in tray until the user opens us
}

func main() {
	// Writable data home: everything relative lands here after chdir.
	dataDir, err := os.UserConfigDir() // %APPDATA% on Windows
	if err != nil {
		panic("no user config dir: " + err.Error())
	}
	dataDir = filepath.Join(dataDir, "Seekify")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		panic(err)
	}
	if err := os.Chdir(dataDir); err != nil {
		panic(err)
	}

	loadDotEnv(".env")

	// Consume --hidden BEFORE anything calls flag.Parse (runServer does):
	// the shared flag set doesn't define it and ExitOnError would kill the
	// app at every autostart.
	hidden, filteredArgs := desktopconfig.ParseHidden(os.Args)
	os.Args = filteredArgs

	d := &desktopApp{}

	app := application.New(application.Options{
		Name: "Seekify",
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "ca.sadoway.seekify",
			OnSecondInstanceLaunch: func(_ application.SecondInstanceData) {
				d.showWindow()
			},
		},
		Services: []application.Service{application.NewService(d)},
	})
	d.app = app

	// Auto-update from GitHub Releases: SHA256SUMS digest verification,
	// 24h background checks. Release asset picked by the default matcher:
	// seekify-windows-amd64.exe (installers are ignored).
	gh, err := github.New(github.Config{
		Repository:    UpdateRepository,
		ChecksumAsset: "SHA256SUMS",
	})
	if err != nil {
		log.Printf("[desktop] updater provider: %v", err)
	} else if err := app.Updater.Init(updater.Config{
		CurrentVersion: Version,
		Providers:      []updater.Provider{gh},
		CheckInterval:  24 * time.Hour,
	}); err != nil {
		log.Printf("[desktop] updater init: %v", err)
	}

	d.window = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:   "main",
		Title:  "Seekify",
		Hidden: true, // shown once the server answers
	})
	d.setupURLAndPort()
	d.setupCloseToTray()
	d.startHidden = hidden
	d.setupTray()

	if err := app.Run(); err != nil {
		panic(err)
	}
}

// ServiceStartup runs once the app event loop is live (dialogs need it):
// first-run picker → tools sync → server start → show window.
func (d *desktopApp) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	if desktopconfig.NeedsMusicDir(os.Getenv) {
		if !d.pickMusicDir() {
			d.app.Quit() // cancelled twice — exit before any server starts
			return nil
		}
	}

	// Seed writable tool copies (yt-dlp -U needs a writable home).
	if exe, err := os.Executable(); err == nil {
		if n, err := desktopconfig.SyncTools(filepath.Join(filepath.Dir(exe), "tools"), "bin"); err != nil {
			log.Printf("[desktop] tool sync: %v", err)
		} else if n > 0 {
			log.Printf("[desktop] synced %d bundled tool(s) into bin/", n)
		}
	}

	srv, errCh, err := runServer(false)
	if err != nil {
		d.app.Dialog.Error().SetTitle("Seekify could not start").SetMessage(err.Error()).Show()
		d.app.Quit()
		return nil
	}
	d.srv, d.errCh = srv, errCh

	// Surface fatal server errors (e.g. port in use) as a dialog, not a
	// silent log.Fatalf with no console. ErrServerClosed = our own shutdown.
	go func() {
		if err := <-errCh; err != nil && !errors.Is(err, http.ErrServerClosed) {
			d.app.Dialog.Error().SetTitle("Seekify server error").SetMessage(err.Error()).Show()
			d.app.Quit()
		}
	}()

	d.waitServerThenShow()
	return nil
}

func (d *desktopApp) ServiceShutdown() error {
	if d.srv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = d.srv.Shutdown(ctx)
	}
	return nil
}

// pickMusicDir shows the first-run flow. Returns false when the user
// bails (cancelled twice). Writes MUSIC_DIR into .env on success.
func (d *desktopApp) pickMusicDir() bool {
	for attempt := 0; attempt < 2; attempt++ {
		q := d.app.Dialog.Question().
			SetTitle("Welcome to Seekify").
			SetMessage("Choose the folder that holds your music library.\nYou can change it later in " + mustCwd() + " → .env")
		proceed := make(chan bool, 1)
		yes := q.AddButton("Choose Folder")
		yes.OnClick(func() { proceed <- true })
		cancel := q.AddButton("Not Now")
		cancel.OnClick(func() { proceed <- false })
		q.SetCancelButton(cancel)
		q.SetDefaultButton(yes)
		q.Show()
		if !<-proceed {
			continue
		}

		path, err := d.app.Dialog.OpenFile().
			SetTitle("Select your music folder").
			SetDirectory(desktopconfig.DefaultMusicDir()).
			CanChooseDirectories(true).
			CanChooseFiles(false).
			PromptForSingleSelection()
		if err != nil || path == "" {
			continue // picker cancelled — re-prompt (exit on second cancel)
		}
		if err := desktopconfig.AppendEnvVar(".env", "MUSIC_DIR", path); err != nil {
			d.app.Dialog.Error().SetTitle("Seekify").SetMessage("Could not save music folder: " + err.Error()).Show()
			return false
		}
		os.Setenv("MUSIC_DIR", path)
		return true
	}
	return false
}

func mustCwd() string {
	wd, _ := os.Getwd()
	return wd
}

func (d *desktopApp) setupURLAndPort() {
	d.port = os.Getenv("PORT")
	if d.port == "" {
		d.port = "8081"
	}
	d.window.SetURL("http://localhost:" + d.port)
}

func (d *desktopApp) setupCloseToTray() {
	// X button hides to tray; "Shutdown Server" is the real exit.
	d.window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		event.Cancel()
		d.window.Hide()
	})
}

func (d *desktopApp) setupTray() {
	tray := d.app.SystemTray.New()
	tray.SetIcon(trayIcon)
	tray.SetLabel("Seekify " + Version)

	menu := d.app.NewMenu()
	menu.Add("Open Seekify").OnClick(func(*application.Context) { d.showWindow() })
	menu.AddSeparator()

	autoOn := false
	if d.app.Autostart != nil {
		if on, err := d.app.Autostart.IsEnabled(); err == nil {
			autoOn = on
		}
	}
	menu.AddCheckbox("Start with Windows", autoOn).OnClick(func(ctx *application.Context) {
		want := ctx.ClickedMenuItem().Checked()
		var err error
		if want {
			err = d.app.Autostart.EnableWithOptions(application.AutostartOptions{
				Arguments: []string{"--hidden"},
			})
		} else {
			err = d.app.Autostart.Disable()
		}
		if err != nil {
			log.Printf("[desktop] autostart: %v", err)
		}
		menu.Update()
	})

	updateItem := menu.Add("Check for Updates…")
	updateItem.OnClick(func(*application.Context) {
		if d.app.Updater != nil {
			go func() {
				if err := d.app.Updater.CheckAndInstall(context.Background()); err != nil {
					log.Printf("[desktop] update check: %v", err)
				}
			}()
		}
	})
	menu.AddSeparator()

	menu.Add("Restart Server").OnClick(func(*application.Context) { d.restartServer() })
	menu.Add("Shutdown Server").OnClick(func(*application.Context) { d.app.Quit() })
	menu.Update()
	tray.SetMenu(menu)

	tray.OnClick(func() { d.showWindow() })
}

func (d *desktopApp) showWindow() {
	if d.window == nil {
		return
	}
	d.window.Restore()
	d.window.Show()
	d.window.Focus()
}

// waitServerThenShow polls the server root until it answers (or 30s pass)
// before showing the window, so the user never sees a dead page.
func (d *desktopApp) waitServerThenShow() {
	url := "http://localhost:" + d.port + "/"
	go func() {
		deadline := time.Now().Add(30 * time.Second)
		for time.Now().Before(deadline) {
			resp, err := http.Get(url) //nolint:gosec // fixed localhost URL
			if err == nil {
				resp.Body.Close()
				if !d.startHidden {
					d.showWindow()
				}
				return
			}
			time.Sleep(200 * time.Millisecond)
		}
		log.Printf("[desktop] server did not answer %s within 30s", url)
	}()
}

// restartServer shuts the HTTP server down, then relaunches via a detached
// helper that waits for this process to exit first — the single-instance
// mutex dies with us, so the new process starts clean instead of bouncing
// back as a "second instance".
func (d *desktopApp) restartServer() {
	if d.srv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = d.srv.Shutdown(ctx)
	}
	exe, err := os.Executable()
	if err != nil {
		log.Printf("[desktop] restart: %v", err)
		return
	}
	if runtime.GOOS != "windows" {
		log.Printf("[desktop] restart only supported in the Windows build")
		d.app.Quit()
		return
	}
	pid := os.Getpid()
	script := fmt.Sprintf(`while (Get-Process -Id %d -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 200 }; Start-Process -FilePath '%s'`, pid, exe)
	cmd := exec.Command("powershell", "-NoProfile", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000008} // DETACHED_PROCESS
	if err := cmd.Start(); err != nil {
		log.Printf("[desktop] restart helper: %v", err)
	}
	d.app.Quit()
}
