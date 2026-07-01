package store

import (
	"log"
	"runtime/debug"
)

// SafeGo launches a goroutine that recovers from panics, preventing a single
// worker crash from taking down the entire server. One-shot goroutines should
// use this; long-running loops should wrap their loop body inline so the loop
// survives after a panic.
func SafeGo(name string, fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[worker:%s] panic recovered: %v\n%s", name, r, debug.Stack())
			}
		}()
		fn()
	}()
}
