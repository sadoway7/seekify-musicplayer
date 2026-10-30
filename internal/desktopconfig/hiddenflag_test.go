package desktopconfig

import (
	"reflect"
	"testing"
)

func TestParseHiddenStripsFlagAndReports(t *testing.T) {
	cases := []struct {
		name   string
		in     []string
		hidden bool
		out    []string
	}{
		{"no flag", []string{"seekify.exe"}, false, []string{"seekify.exe"}},
		{"flag present", []string{"seekify.exe", "--hidden"}, true, []string{"seekify.exe"}},
		{"flag among others", []string{"seekify.exe", "-dir", "X", "--hidden", "--hidden"}, true, []string{"seekify.exe", "-dir", "X"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			hidden, out := ParseHidden(c.in)
			if hidden != c.hidden {
				t.Errorf("hidden = %v, want %v", hidden, c.hidden)
			}
			if !reflect.DeepEqual(out, c.out) {
				t.Errorf("out = %v, want %v", out, c.out)
			}
		})
	}
}
