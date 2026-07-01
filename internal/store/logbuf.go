package store

import (
	"bytes"
	"io"
	"sync"
)

// LogRingBuffer captures the last N bytes of log output for debugging via
// the admin API. io.MultiWriter sends writes to both stderr and this buffer.
const logRingSize = 256 * 1024 // 256KB — plenty for a boot cycle

var (
	logMu  sync.Mutex
	logBuf *RingBuffer
)

// RingBuffer is a fixed-size byte buffer that overwrites oldest data.
type RingBuffer struct {
	buf  []byte
	r    int // read position
	w    int // write position
	full bool
}

func NewRingBuffer(size int) *RingBuffer {
	return &RingBuffer{buf: make([]byte, size)}
}

func (rb *RingBuffer) Write(p []byte) (int, error) {
	n := len(p)
	for _, b := range p {
		rb.buf[rb.w] = b
		rb.w = (rb.w + 1) % len(rb.buf)
		if rb.w == rb.r {
			rb.full = true
			rb.r = (rb.r + 1) % len(rb.buf)
		}
	}
	if rb.w != rb.r {
		rb.full = false
	}
	return n, nil
}

func (rb *RingBuffer) Bytes() []byte {
	if rb.w == rb.r && !rb.full {
		return nil
	}
	if rb.w > rb.r {
		out := make([]byte, rb.w-rb.r)
		copy(out, rb.buf[rb.r:rb.w])
		return out
	}
	// wrap: w < r
	out := make([]byte, len(rb.buf)-rb.r+rb.w)
	copy(out, rb.buf[rb.r:])
	copy(out[len(rb.buf)-rb.r:], rb.buf[:rb.w])
	return out
}

// InitLogCapture sets up the ring buffer and returns a writer that should be
// passed to log.SetOutput (alongside os.Stderr via io.MultiWriter).
func InitLogCapture() io.Writer {
	logMu.Lock()
	defer logMu.Unlock()
	logBuf = NewRingBuffer(logRingSize)
	return logBuf
}

// GetLogBuffer returns the current log buffer contents (thread-safe snapshot).
func GetLogBuffer() []byte {
	logMu.Lock()
	defer logMu.Unlock()
	if logBuf == nil {
		return []byte("(log capture not initialized)")
	}
	return logBuf.Bytes()
}

// FilterTrackLogs returns only lines containing [track-new] for quick
// provenance checks.
func FilterTrackLogs() []byte {
	all := GetLogBuffer()
	var out bytes.Buffer
	for _, line := range bytes.Split(all, []byte("\n")) {
		if bytes.Contains(line, []byte("[track-new]")) || bytes.Contains(line, []byte("[db]")) {
			out.Write(line)
			out.WriteByte('\n')
		}
	}
	return out.Bytes()
}
